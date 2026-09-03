from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import require_control_roles
from app.core.errors import APIError
from app.db.platform import PlatformSessionLocal, get_platform_session
from app.db.tenant import tenant_engines
from app.models.platform import Tenant
from app.models.tenant import Company
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import platform_audit
from app.services.managed_whatsapp import managed_whatsapp_for_tenant
from app.services.phones import normalize_brazil_phone
from app.services.tenant_resolver import TenantResolver

router = APIRouter(prefix="/api/control/v1/whatsapp", tags=["Control Plane - WhatsApp"])


class WhatsAppControlRequest(BaseModel):
    phone: str | None = Field(default=None, max_length=32)
    company_id: UUID | None = None


class WhatsAppControlTestRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=32)
    message: str = Field(min_length=1, max_length=4096)
    company_id: UUID | None = None


def _public(data: object, *, default_state: str = "UNKNOWN") -> dict[str, Any]:
    state = default_state
    pairing_code: str | None = None
    qr_base64: str | None = None
    number: str | None = None
    profile_name: str | None = None

    def walk(value: object) -> None:
        nonlocal state, pairing_code, qr_base64, number, profile_name
        if isinstance(value, dict):
            for key, item in value.items():
                lowered = str(key).lower()
                if isinstance(item, str):
                    text = item.strip()
                    if lowered in {"state", "status", "connectionstatus", "connection_status"} and text:
                        normalized = text.upper()
                        state = {
                            "OPEN": "CONNECTED",
                            "ONLINE": "CONNECTED",
                            "CONNECTED": "CONNECTED",
                            "CONNECTING": "CONNECTING",
                            "PAIRING": "CONNECTING",
                            "QR": "CONNECTING",
                            "RECONNECTING": "RECONNECTING",
                            "CLOSE": "DISCONNECTED",
                            "CLOSED": "DISCONNECTED",
                            "DISCONNECTED": "DISCONNECTED",
                        }.get(normalized, normalized)
                    elif lowered in {"pairingcode", "pairing_code", "pairing-code"} and text:
                        pairing_code = pairing_code or text
                    elif lowered in {"base64", "qrbase64", "qrcode", "image"} and text and len(text) > 100:
                        qr_base64 = qr_base64 or text
                    elif lowered in {"number", "ownerjid", "owner_jid", "owner", "wid", "jid"} and text:
                        number = number or text.split("@")[0]
                    elif lowered in {"profilename", "profile_name"} and text:
                        profile_name = profile_name or text
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(data)
    return {
        "state": state,
        "pairing_code": pairing_code,
        "qr_base64": qr_base64,
        "number": number,
        "profile_name": profile_name,
        "session_exists": False,
    }


async def _snapshot(service: Any) -> dict[str, Any]:
    raw = await service.provider.connection_snapshot()
    connection = _public(raw.get("information") or {}, default_state=str(raw.get("state") or "UNKNOWN"))
    status = _public(raw.get("status") or {}, default_state=str(raw.get("state") or "UNKNOWN"))
    for key in ("number", "profile_name"):
        if status.get(key) and not connection.get(key):
            connection[key] = status[key]
    connection["state"] = str(raw.get("state") or connection.get("state") or "UNKNOWN")
    connection["session_exists"] = bool(raw.get("session_exists"))
    if connection["session_exists"]:
        connection["pairing_code"] = None
        connection["qr_base64"] = None
    return connection


async def _tenant_company(session: Any, tenant: Tenant, company_id: UUID | None) -> Company | None:
    context = await TenantResolver(session).resolve_by_id(str(tenant.id), require_active=False)
    entry = await tenant_engines.get(context)
    async with entry.session_factory() as tenant_session:
        if company_id:
            company = await tenant_session.get(Company, company_id)
            if company is None:
                raise APIError("COMPANY_NOT_FOUND", "Empresa emissora não encontrada neste cliente.", 404)
            return company
        return await tenant_session.scalar(
            select(Company).where(Company.is_active.is_(True)).order_by(Company.created_at, Company.id).limit(1)
        )


async def _status(tenant: Tenant, semaphore: asyncio.Semaphore) -> dict[str, Any]:
    async with semaphore:
        try:
            service = await managed_whatsapp_for_tenant(tenant.slug, tenant.id)
        except APIError as exc:
            return {
                "tenant_id": str(tenant.id),
                "tenant_name": tenant.name,
                "tenant_slug": tenant.slug,
                "instance": None,
                "instance_mode": "TENANT",
                "operations_available": False,
                "connection": {"state": "NOT_CONFIGURED", "session_exists": False, "message": exc.message},
            }
        try:
            connection = await _snapshot(service)
        except (APIError, httpx.HTTPError):
            connection = {
                "state": "UNAVAILABLE",
                "pairing_code": None,
                "qr_base64": None,
                "number": None,
                "profile_name": None,
                "session_exists": False,
            }
        return {
            "tenant_id": str(tenant.id),
            "tenant_name": tenant.name,
            "tenant_slug": tenant.slug,
            "instance": service.instance,
            "instance_mode": service.instance_mode,
            "operations_available": service.managed_instance,
            "connection": connection,
        }


@router.get("/instances", response_model=SuccessResponse[list[dict]])
async def list_whatsapp_instances(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
) -> SuccessResponse[list[dict]]:
    async with PlatformSessionLocal() as session:
        tenants = list((await session.scalars(select(Tenant).order_by(Tenant.name))).all())
    semaphore = asyncio.Semaphore(8)
    return SuccessResponse(data=await asyncio.gather(*[_status(tenant, semaphore) for tenant in tenants]))


@router.post("/instances/{tenant_id}/test-message", response_model=SuccessResponse[dict])
async def test_whatsapp_message(
    tenant_id: UUID,
    payload: WhatsAppControlTestRequest,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session=Depends(get_platform_session),
) -> SuccessResponse[dict]:
    """Envia uma mensagem de diagnóstico sem expor a credencial da Evolution."""
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Cliente não encontrado.", 404)
    service = await managed_whatsapp_for_tenant(tenant.slug, tenant.id)
    if not service.managed_instance:
        raise APIError(
            "WHATSAPP_SHARED_INSTANCE",
            "Teste individual bloqueado para instância compartilhada.",
            409,
        )
    snapshot = await service.provider.connection_snapshot()
    if str(snapshot.get("state") or "").upper() != "CONNECTED":
        raise APIError(
            "WHATSAPP_NOT_CONNECTED",
            "A conexão deste cliente não está pronta para envio. Atualize o estado antes do teste.",
            409,
            {"state": snapshot.get("state")},
        )
    company = await _tenant_company(session, tenant, payload.company_id)
    phone = normalize_brazil_phone(payload.phone, company=company, field_name="número de destino")
    try:
        result = await service.provider.send_text(phone, payload.message)
    except httpx.HTTPError as exc:
        raise APIError(
            "WHATSAPP_SERVICE_UNAVAILABLE",
            "O serviço de WhatsApp não respondeu ao teste de envio.",
            503,
        ) from exc

    await platform_audit(
        session,
        action="whatsapp.control.test_sent",
        entity_type="WhatsAppInstance",
        entity_id=service.instance,
        actor_id=user.id,
        tenant_id=str(tenant.id),
        after={
            "destination": f"***{phone[-4:]}",
            "external_id": result.external_id,
            "status": result.status,
        },
        context={"origin": "control-plane", "diagnostic": True},
    )
    await session.commit()
    return SuccessResponse(
        data={
            "tenant_id": str(tenant.id),
            "tenant_name": tenant.name,
            "instance": service.instance,
            "destination": f"***{phone[-4:]}",
            "external_id": result.external_id,
            "status": result.status,
        }
    )


@router.post("/instances/{tenant_id}/actions/{action}", response_model=SuccessResponse[dict])
async def operate_whatsapp_instance(
    tenant_id: UUID,
    action: str,
    payload: WhatsAppControlRequest,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session=Depends(get_platform_session),
) -> SuccessResponse[dict]:
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Cliente não encontrado.", 404)
    service = await managed_whatsapp_for_tenant(tenant.slug, tenant.id)
    if not service.managed_instance:
        raise APIError(
            "WHATSAPP_SHARED_INSTANCE",
            "A configuração atual usa instância compartilhada; a operação individual está bloqueada para proteger os demais clientes.",
            409,
        )

    normalized = action.strip().lower()
    phone: str | None = None
    if normalized == "connect" and payload.phone:
        company = await _tenant_company(session, tenant, payload.company_id)
        phone = normalize_brazil_phone(payload.phone, company=company, field_name="número usado no pareamento")

    try:
        if normalized == "create":
            result = await service.provider.create_instance()
        elif normalized == "connect":
            result = await service.provider.connect_instance(phone)
        elif normalized == "disconnect":
            result = await service.provider.disconnect_instance()
        elif normalized == "restart":
            result = await service.provider.restart_instance()
        elif normalized == "delete":
            result = await service.provider.delete_instance()
        else:
            raise APIError("WHATSAPP_ACTION_INVALID", "Ação de WhatsApp inválida.", 422)
    except httpx.HTTPError as exc:
        raise APIError(
            "WHATSAPP_SERVICE_UNAVAILABLE",
            "O serviço de WhatsApp está temporariamente indisponível.",
            503,
        ) from exc

    result_public = _public(result)
    try:
        current = await _snapshot(service)
        for key in ("number", "profile_name", "pairing_code", "qr_base64"):
            if current.get(key):
                result_public[key] = current[key]
        result_public["state"] = current["state"]
        result_public["session_exists"] = current["session_exists"]
        if current["session_exists"]:
            result_public["pairing_code"] = None
            result_public["qr_base64"] = None
    except (APIError, httpx.HTTPError):
        pass

    if normalized == "disconnect":
        result_public.update(
            {
                "state": "DISCONNECTED",
                "session_exists": False,
                "pairing_code": None,
                "qr_base64": None,
            }
        )
    if normalized == "delete":
        result_public.update(
            {
                "state": "NOT_CREATED",
                "number": None,
                "profile_name": None,
                "session_exists": False,
                "pairing_code": None,
                "qr_base64": None,
            }
        )

    await platform_audit(
        session,
        action=f"whatsapp.control.{normalized}",
        entity_type="WhatsAppInstance",
        entity_id=service.instance,
        actor_id=user.id,
        tenant_id=str(tenant.id),
        after={
            "state": result_public.get("state"),
            "number": result_public.get("number"),
            "session_exists": bool(result_public.get("session_exists")),
        },
        context={"origin": "control-plane"},
    )
    await session.commit()
    return SuccessResponse(
        data={
            "tenant_id": str(tenant.id),
            "tenant_name": tenant.name,
            "instance": service.instance,
            "connection": result_public,
        }
    )
