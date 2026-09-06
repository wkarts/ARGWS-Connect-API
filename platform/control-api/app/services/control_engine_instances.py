"""Control Plane view/actions over the SAME EngineBindings used by customers.

No discovery, implicit adoption or fallback to a global notification connection.
The Engine and its sessions are not migrated or reassigned by reading this view.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from uuid import UUID

from sqlalchemy import select

from app.core.errors import APIError
from app.db.platform import PlatformSessionLocal
from app.models.platform import EngineBinding, Tenant
from app.schemas.connect_engine import EngineInstanceCreate
from app.services.audit import platform_audit
from app.services.connect_engine import connect_engine
from app.services.instance_lifecycle import READY, ensure_instance, pairing_response, reserve_instance
from app.services.tenant_resolver import TenantResolver


def connection_state(data: object) -> dict:
    data = data if isinstance(data, dict) else {}
    item = data.get("instance", data)
    item = item if isinstance(item, dict) else {}
    value = str(item.get("state") or item.get("status") or "UNKNOWN").upper()
    state = {"OPEN": "CONNECTED", "CLOSE": "DISCONNECTED", "CLOSED": "DISCONNECTED"}.get(value, value)
    # Only an observed OPEN indicates a live authenticated session; do not infer from other customers.
    return {"state": state, "session_exists": state == "CONNECTED", "pairing_code": None, "qr_base64": None}


async def snapshot(tenant: Tenant, binding: EngineBinding | None) -> dict:
    result = {"tenant_id": str(tenant.id), "tenant_name": tenant.name, "tenant_slug": tenant.slug,
              "binding_id": str(binding.id) if binding else None, "alias": binding.alias if binding else None,
              "instance": binding.instance_name if binding else None, "instance_mode": "TENANT",
              "binding_status": binding.status if binding else "NOT_CREATED",
              "provider": binding.provider if binding else None,
              "origin": (binding.metadata_json or {}).get("origin", "PLATFORM_CREATED") if binding else None,
              "operations_available": tenant.status == "ACTIVE",
              "pairing_available": bool(binding and binding.status in READY and binding.provider == "WHATSAPP-BAILEYS"),
              "connection": {"state": "NOT_CREATED", "session_exists": False, "message": "Sem instância vinculada a este cliente."}}
    if binding is None:
        return result
    if binding.status not in READY:
        result["connection"] = {"state": "CREATE_PENDING", "session_exists": False,
                                "message": binding.last_error or "Criação pendente de verificação."}
        return result
    try:
        state = await asyncio.wait_for(connect_engine.connection_state(binding.instance_name), timeout=5)
        result["connection"] = connection_state(state)
    except (APIError, TimeoutError) as exc:
        result["connection"] = {"state": "UNAVAILABLE", "session_exists": False,
                                "message": exc.message if isinstance(exc, APIError) else "Consulta ao Engine demorou; o vínculo permanece registrado."}
    return result


async def list_instances() -> list[dict]:
    async with PlatformSessionLocal() as session:
        tenants = list((await session.scalars(select(Tenant).order_by(Tenant.name))).all())
        bindings = list((await session.scalars(select(EngineBinding).order_by(EngineBinding.created_at, EngineBinding.id))).all())
    grouped = defaultdict(list)
    for binding in bindings:
        grouped[binding.tenant_id].append(binding)
    semaphore = asyncio.Semaphore(4)
    async def one(tenant, binding):
        async with semaphore:
            return await snapshot(tenant, binding)
    return await asyncio.gather(*(one(tenant, binding) for tenant in tenants
                                  for binding in (grouped[tenant.id] or [None])))


async def resolve_binding(session, tenant_id: UUID, binding_id: UUID | None) -> EngineBinding:
    stmt = select(EngineBinding).where(EngineBinding.tenant_id == tenant_id)
    if binding_id is not None:
        stmt = stmt.where(EngineBinding.id == binding_id)
    rows = list((await session.scalars(stmt.limit(2))).all())
    if not rows:
        raise APIError("ENGINE_BINDING_NOT_FOUND", "Instância não encontrada neste cliente.", 404)
    if len(rows) != 1:
        raise APIError("ENGINE_BINDING_REQUIRED", "Selecione a instância deste cliente antes da operação.", 409)
    return rows[0]


async def operate(session, tenant: Tenant, user, action: str, binding_id: UUID | None, phone: str | None, alias: str | None) -> dict:
    if action not in {"create", "connect", "restart", "disconnect", "delete"}:
        raise APIError("WHATSAPP_ACTION_INVALID", "Ação de WhatsApp inválida.", 422)
    context = await TenantResolver(session).resolve_by_id(str(tenant.id), require_active=True)
    if action == "create":
        if binding_id is not None:
            binding = await resolve_binding(session, tenant.id, binding_id)
            target_id = binding.id
            await session.commit()
        else:
            await session.commit()
            target_id = await reserve_instance(context, user, EngineInstanceCreate(alias=alias or "whatsapp", qrcode=False))
        await ensure_instance(context, user, target_id)
        binding = await resolve_binding(session, tenant.id, target_id)
        await session.commit()
        return await snapshot(tenant, binding)
    binding = await resolve_binding(session, tenant.id, binding_id)
    if binding.status not in READY:
        raise APIError("ENGINE_CREATION_PENDING", "Verifique a criação pendente antes de operar a instância.", 409)
    if action == "connect" and binding.provider != "WHATSAPP-BAILEYS":
        raise APIError("PAIRING_NOT_SUPPORTED", "Este provedor não utiliza QR Code ou código de pareamento.", 422)
    if action == "delete" and (binding.metadata_json or {}).get("origin") == "ADOPTED_EXISTING":
        raise APIError("ENGINE_ADOPTED_DELETE_BLOCKED", "Uma instância adotada deve ser desvinculada no console do cliente; a sessão do Engine será preservada.", 409)
    await session.commit()
    if action == "connect":
        qr = pairing_response(await connect_engine.connect_instance(binding.instance_name, phone))
        result = await snapshot(tenant, binding)
        if not result["connection"]["session_exists"]:
            result["connection"].update(pairing_code=qr["pairing_code"], qr_base64=qr["base64"],
                message="Pareamento em preparação." if qr["pending"] else None)
    else:
        operations = {"restart": connect_engine.restart_instance, "disconnect": connect_engine.logout_instance,
                      "delete": connect_engine.delete_instance}
        await operations[action](binding.instance_name)
        result = await snapshot(tenant, None if action == "delete" else binding)
        if action == "delete":
            row = await resolve_binding(session, tenant.id, binding.id)
            await session.delete(row)
        if action == "disconnect":
            result["connection"] = {"state": "DISCONNECTED", "session_exists": False, "pairing_code": None, "qr_base64": None}
    await platform_audit(session, action="connect.control.instance." + action, entity_type="EngineBinding",
                         entity_id=str(binding.id), actor_id=user.id, tenant_id=str(tenant.id),
                         after={"state": result["connection"]["state"]})
    await session.commit()
    return result


async def test_message(session, tenant: Tenant, user, binding_id: UUID | None, phone: str, message: str) -> dict:
    await TenantResolver(session).resolve_by_id(str(tenant.id), require_active=True)
    binding = await resolve_binding(session, tenant.id, binding_id)
    if binding.status not in READY:
        raise APIError("ENGINE_CREATION_PENDING", "Conclua a criação antes do teste de envio.", 409)
    await session.commit()
    state = connection_state(await connect_engine.connection_state(binding.instance_name))
    if state["state"] != "CONNECTED":
        raise APIError("WHATSAPP_NOT_CONNECTED", "A instância selecionada não está conectada.", 409)
    raw = await connect_engine.send_text(binding.instance_name, {"number": phone, "text": message})
    key = raw.get("key", {}) if isinstance(raw, dict) else {}
    external_id = key.get("id") if isinstance(key, dict) else None
    result = {"tenant_id": str(tenant.id), "tenant_name": tenant.name, "binding_id": str(binding.id),
              "instance": binding.instance_name, "destination": "***" + phone[-4:],
              "external_id": external_id if isinstance(external_id, str) else None, "status": "ACCEPTED"}
    await platform_audit(session, action="connect.control.instance.test_sent", entity_type="EngineBinding",
                         entity_id=str(binding.id), actor_id=user.id, tenant_id=str(tenant.id),
                         after={"destination": result["destination"]})
    await session.commit()
    return result
