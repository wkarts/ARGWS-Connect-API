"""Durable instance reservation; pairing is never part of the create transaction."""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, select

from app.core.config import settings
from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.db.platform import PlatformSessionLocal
from app.models.platform import EngineBinding, Tenant
from app.services.audit import platform_audit
from app.services.connect_engine import connect_engine
from app.services.entitlements import load_tenant_entitlements


READY = {"CREATED", "ADOPTED", "ACTIVE"}


def public_binding(item: EngineBinding) -> dict:
    return {"id": str(item.id), "alias": item.alias, "instance_name": item.instance_name,
            "provider": item.provider, "status": item.status,
            "last_error": item.last_error, "pairing_required": item.provider == "WHATSAPP-BAILEYS"}


def creation_body(payload) -> dict:
    body = {"integration": payload.integration, "number": payload.number,
            "rejectCall": payload.reject_call, "msgCall": payload.msg_call,
            "groupsIgnore": payload.groups_ignore, "alwaysOnline": payload.always_online,
            "readMessages": payload.read_messages, "readStatus": payload.read_status,
            "syncFullHistory": payload.sync_full_history, **payload.extra}
    return {key: value for key, value in body.items() if value is not None}


async def reserve_instance(context, user, payload) -> UUID:
    body = creation_body(payload)
    fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    async with PlatformSessionLocal() as session:
        # Serialize quota + alias checks for ALL creators/adopters of this customer.
        await session.scalar(select(Tenant).where(Tenant.id == UUID(context.tenant_id)).with_for_update())
        entitlement = await load_tenant_entitlements(session, context.tenant_id)
        entitlement.require_feature("instances")
        existing = await session.scalar(select(EngineBinding).where(
            EngineBinding.tenant_id == UUID(context.tenant_id), EngineBinding.alias == payload.alias))
        if existing is not None:
            if (existing.metadata_json or {}).get("create_fingerprint") != fingerprint:
                raise APIError("ENGINE_ALIAS_EXISTS", "O alias já está reservado com outra configuração.", 409)
            return existing.id
        count = await session.scalar(select(func.count()).select_from(EngineBinding).where(
            EngineBinding.tenant_id == UUID(context.tenant_id)))
        entitlement.enforce_limit("instances", count or 0)
        binding_id = uuid4()
        item = EngineBinding(
            id=binding_id, tenant_id=UUID(context.tenant_id), alias=payload.alias,
            instance_name=f"t-{UUID(context.tenant_id).hex}-{binding_id.hex}",
            provider=payload.integration, status="CREATE_PENDING",
            metadata_json={"created_by": user.id, "create_fingerprint": fingerprint,
                           "create_body": body, "ownership_token": secret_cipher.encrypt(secrets.token_urlsafe(48))},
        )
        session.add(item)
        await session.flush()
        await platform_audit(session, action="connect.engine.instance.reserve", entity_type="EngineBinding",
                             entity_id=str(item.id), actor_id=user.id, tenant_id=context.tenant_id,
                             after={"alias": item.alias, "instance_name": item.instance_name})
        await session.commit()
        return binding_id


async def ensure_instance(context, user, binding_id: UUID) -> dict:
    operation = uuid4().hex
    async with PlatformSessionLocal() as session:
        await session.scalar(select(Tenant).where(Tenant.id == UUID(context.tenant_id)).with_for_update())
        entitlement = await load_tenant_entitlements(session, context.tenant_id)
        entitlement.require_feature("instances")
        item = await session.scalar(select(EngineBinding).where(
            EngineBinding.id == binding_id, EngineBinding.tenant_id == UUID(context.tenant_id)).with_for_update())
        if item is None:
            raise APIError("ENGINE_BINDING_NOT_FOUND", "Instância não encontrada neste ambiente.", 404)
        if item.status in READY:
            return public_binding(item)
        meta = dict(item.metadata_json or {})
        now = datetime.now(UTC)
        if meta.get("lease_until") and datetime.fromisoformat(meta["lease_until"]) > now:
            return public_binding(item)
        if not meta.get("ownership_token") or not meta.get("create_body"):
            raise APIError("ENGINE_RECONCILIATION_UNAVAILABLE", "Esta instância exige revisão administrativa.", 409)
        token = secret_cipher.decrypt(meta["ownership_token"])
        retry = bool(meta.get("attempted_at"))
        meta.update(operation=operation, attempted_at=now.isoformat(),
                    lease_until=(now + timedelta(seconds=max(120, settings.connect_engine_timeout_seconds * 3))).isoformat())
        item.metadata_json = meta
        item.status = "CREATING"
        item.last_error = None
        name = item.instance_name
        body = {**meta["create_body"], "instanceName": name, "token": token, "qrcode": False}
        await session.commit()
    # No open database transaction while awaiting the external Engine.
    failure = None
    try:
        owned = None
        if retry:
            try:
                owned = await connect_engine.owned_instance(name, token)
            except APIError as exc:
                if exc.code not in {"ENGINE_CREDENTIAL_REJECTED", "ENGINE_INSTANCE_NOT_FOUND"}:
                    raise
        if owned is None:
            response = await connect_engine.create_instance(body)
            instance = response.get("instance", {}) if isinstance(response, dict) else {}
            if instance.get("instanceName") != name:
                raise APIError("ENGINE_CREATE_UNCONFIRMED", "A criação ainda não foi confirmada. Use Verificar criação.", 502)
        # Ownership proof is required to reconcile an earlier uncertain response;
        # same name alone is never proof. A conflicting POST cannot adopt or mutate it.
    except APIError as exc:
        failure = exc
    except Exception:
        failure = APIError("ENGINE_CREATE_UNCONFIRMED", "A criação ainda não foi confirmada. Use Verificar criação.", 502)
    async with PlatformSessionLocal() as session:
        item = await session.scalar(select(EngineBinding).where(EngineBinding.id == binding_id).with_for_update())
        if item is None or (item.metadata_json or {}).get("operation") != operation:
            raise APIError("ENGINE_CREATION_CHANGED", "O estado da operação mudou. Atualize a lista.", 409)
        meta = dict(item.metadata_json)
        meta.pop("lease_until", None)
        meta.pop("operation", None)
        item.metadata_json = meta
        item.status = "CREATE_PENDING" if failure else "CREATED"
        item.last_error = failure.message if failure else None
        await platform_audit(session, action="connect.engine.instance.create_pending" if failure else "connect.engine.instance.create",
                             entity_type="EngineBinding", entity_id=str(item.id), actor_id=user.id,
                             tenant_id=context.tenant_id, after={"status": item.status, "error_code": failure.code if failure else None})
        await session.commit()
        result = public_binding(item)
    if failure:
        raise APIError(failure.code, failure.message, failure.status_code,
                       {"binding_id": str(binding_id), "creation_reserved": True})
    return result


def pairing_response(payload: object) -> dict:
    """Only data needed by the pairing UI; exclude Engine credentials/session internals."""
    data = payload if isinstance(payload, dict) else {}
    if isinstance(data.get("qrcode"), dict):
        data = data["qrcode"]
    base64 = data.get("base64")
    if not isinstance(base64, str) or not base64.startswith("data:image/png;base64,") or len(base64) > 2_000_000:
        base64 = None
    code = data.get("pairingCode") or data.get("pairing_code")
    code = code if isinstance(code, str) and len(code) <= 32 else None
    instance = data.get("instance") if isinstance(data.get("instance"), dict) else {}
    return {"base64": base64, "pairing_code": code, "state": instance.get("state"),
            "pending": not bool(base64 or code) and instance.get("state") != "open"}
