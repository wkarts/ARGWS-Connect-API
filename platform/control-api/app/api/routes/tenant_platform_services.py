from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_tenant_context_dep, get_tenant_db, require_permission
from app.core.config import settings
from app.core.errors import APIError
from app.core.tenant_context import TenantContext
from app.db.platform import PlatformSessionLocal
from app.models.platform import PlatformIntegration, Tenant
from app.models.tenant import Company, IntegrationSetting
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import tenant_audit
from app.services.managed_whatsapp import managed_whatsapp
from app.services.phones import normalize_brazil_phone

router = APIRouter(prefix="/api/v1", tags=["Serviços da plataforma"])


class WhatsAppConnectRequest(BaseModel):
    phone: str | None = Field(default=None, max_length=32)
    company_id: UUID | None = None


def _state(payload: dict[str, Any]) -> str:
    candidates: list[object] = [payload.get("state"), payload.get("status"), payload.get("connectionStatus")]
    instance = payload.get("instance")
    if isinstance(instance, dict):
        candidates.extend([instance.get("state"), instance.get("status"), instance.get("connectionStatus")])
    connection = payload.get("connection")
    if isinstance(connection, dict):
        candidates.extend([connection.get("state"), connection.get("status"), connection.get("connectionStatus")])
    value = str(next((candidate for candidate in candidates if candidate), "UNKNOWN")).upper()
    return {
        "OPEN": "CONNECTED",
        "CONNECTED": "CONNECTED",
        "ONLINE": "CONNECTED",
        "CONNECTING": "CONNECTING",
        "PAIRING": "CONNECTING",
        "QR": "CONNECTING",
        "CLOSE": "DISCONNECTED",
        "CLOSED": "DISCONNECTED",
        "DISCONNECTED": "DISCONNECTED",
        "RECONNECTING": "RECONNECTING",
    }.get(value, value)


def _connection_payload(payload: object, *, default_state: str = "UNKNOWN") -> dict[str, Any]:
    found_base64: str | None = None
    found_pairing_code: str | None = None
    found_number: str | None = None
    found_profile: str | None = None
    state = default_state

    def walk(value: object) -> None:
        nonlocal found_base64, found_pairing_code, found_number, found_profile, state
        if isinstance(value, dict):
            local_state = value.get("state") or value.get("status") or value.get("connectionStatus")
            if local_state:
                state = _state({"state": local_state})
            for key, item in value.items():
                lowered = str(key).lower()
                if isinstance(item, str):
                    text = item.strip()
                    if lowered in {"base64", "qrcode", "qr", "image", "qrbase64"} and text:
                        if text.startswith("data:image/"):
                            found_base64 = found_base64 or text
                        elif len(text) > 120:
                            raw = text.split(",")[-1]
                            try:
                                base64.b64decode(raw, validate=False)
                                found_base64 = found_base64 or f"data:image/png;base64,{raw}"
                            except Exception:
                                pass
                    if lowered in {"pairingcode", "pairing_code", "pairing-code"} and text:
                        found_pairing_code = found_pairing_code or text
                    if lowered in {"number", "ownerjid", "owner_jid", "owner", "wid", "jid"} and text:
                        found_number = found_number or text.split("@")[0]
                    if lowered in {"profilename", "profile_name"} and text and len(text) <= 160:
                        found_profile = found_profile or text
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(payload)
    return {
        "state": state,
        "pairing_code": found_pairing_code,
        "qr_base64": found_base64,
        "number": found_number,
        "profile_name": found_profile,
        "session_exists": False,
    }


def _merge_connection(target: dict[str, Any], source: dict[str, Any], *, include_state: bool = True) -> None:
    if include_state and source.get("state") and source.get("state") != "UNKNOWN":
        target["state"] = source["state"]
    for key in ("pairing_code", "qr_base64", "number", "profile_name"):
        if source.get(key):
            target[key] = source[key]
    if source.get("session_exists"):
        target["session_exists"] = True


async def _provider_snapshot(service: Any) -> dict[str, Any]:
    snapshot = await service.provider.connection_snapshot()
    connection = _connection_payload(
        snapshot.get("information") or {},
        default_state=str(snapshot.get("state") or "UNKNOWN"),
    )
    _merge_connection(
        connection,
        _connection_payload(
            snapshot.get("status") or {},
            default_state=str(snapshot.get("state") or "UNKNOWN"),
        ),
        include_state=False,
    )
    connection["state"] = str(snapshot.get("state") or connection.get("state") or "UNKNOWN")
    connection["session_exists"] = bool(snapshot.get("session_exists"))
    if connection["session_exists"]:
        connection["qr_base64"] = None
        connection["pairing_code"] = None
    return connection


async def _managed_setting(session: AsyncSession) -> IntegrationSetting | None:
    return await session.scalar(
        select(IntegrationSetting).where(
            IntegrationSetting.scope == "PLATFORM",
            IntegrationSetting.company_id.is_(None),
            IntegrationSetting.provider == "EVOLUTION",
        )
    )


async def _save_managed_state(
    session: AsyncSession,
    *,
    state: str,
    actor_id: str,
    action: str,
    connection: dict[str, Any] | None = None,
) -> IntegrationSetting:
    item = await _managed_setting(session)
    if item is None:
        item = IntegrationSetting(scope="PLATFORM", company_id=None, provider="EVOLUTION")
        session.add(item)
    item.is_enabled = action != "delete"
    item.public_config = {
        "managed": True,
        "connected_number": (connection or {}).get("number"),
        "profile_name": (connection or {}).get("profile_name"),
        "session_exists": bool((connection or {}).get("session_exists")),
    }
    item.last_health_status = state
    item.last_health_at = datetime.now(UTC)
    item.last_error = None
    await session.flush()
    await tenant_audit(
        session,
        action=f"whatsapp.{action}",
        entity_type="PlatformWhatsApp",
        entity_id=str(item.id),
        actor_id=actor_id,
        after={
            "state": state,
            "number": (connection or {}).get("number"),
            "session_exists": bool((connection or {}).get("session_exists")),
        },
    )
    await session.commit()
    return item


async def _tenant_whatsapp_available(context: TenantContext) -> tuple[bool, bool, dict[str, Any], Any | None]:
    tenant_id = UUID(context.tenant_id)
    async with PlatformSessionLocal() as platform_session:
        tenant = await platform_session.get(Tenant, tenant_id)
        features = dict(tenant.features or {}) if tenant else {}
        integration = await platform_session.scalar(
            select(PlatformIntegration).where(PlatformIntegration.provider == "EVOLUTION")
        )
    configured = bool(
        (
            integration
            and integration.is_enabled
            and integration.encrypted_secrets
            and integration.public_config.get("base_url")
        )
        or (settings.evolution_base_url and settings.evolution_api_key)
    )
    included_in_plan = features.get("whatsapp", True) is not False
    enabled_for_tenant = features.get("whatsapp_enabled", True) is not False
    included = bool(included_in_plan and enabled_for_tenant)
    service = None
    if configured and included:
        try:
            service = await managed_whatsapp(context)
        except APIError:
            service = None
    return configured, included, features, service


async def _company_for_pairing(session: AsyncSession, company_id: UUID | None) -> Company | None:
    if company_id:
        company = await session.get(Company, company_id)
        if company is None:
            raise APIError("COMPANY_NOT_FOUND", "Empresa emissora não encontrada.", 404)
        return company
    return await session.scalar(
        select(Company)
        .where(Company.is_active.is_(True))
        .order_by(Company.created_at, Company.id)
        .limit(1)
    )


@router.get("/platform-services", response_model=SuccessResponse[dict])
async def platform_services(
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("integrations.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    del session
    tenant_id = UUID(context.tenant_id)
    async with PlatformSessionLocal() as platform_session:
        tenant = await platform_session.get(Tenant, tenant_id)
        features = dict(tenant.features or {}) if tenant else {}
        integrations = {
            item.provider: item
            for item in (
                await platform_session.scalars(
                    select(PlatformIntegration).where(
                        PlatformIntegration.provider.in_(
                            ["EVOLUTION", "SMTP", "NFSE_WEBISS", "NFSE_NACIONAL"]
                        )
                    )
                )
            ).all()
        }

    whatsapp_global = integrations.get("EVOLUTION")
    smtp_global = integrations.get("SMTP")
    nfse_nacional_global = integrations.get("NFSE_NACIONAL")
    nfse_webiss_global = integrations.get("NFSE_WEBISS")

    whatsapp_configured = bool(
        (
            whatsapp_global
            and whatsapp_global.is_enabled
            and whatsapp_global.encrypted_secrets
            and whatsapp_global.public_config.get("base_url")
        )
        or (settings.evolution_base_url and settings.evolution_api_key)
    )
    email_configured = bool(
        (smtp_global and smtp_global.is_enabled and smtp_global.public_config.get("host"))
        or (settings.smtp_enabled and settings.smtp_host)
    )

    whatsapp_in_plan = features.get("whatsapp", True) is not False
    whatsapp_tenant_enabled = features.get("whatsapp_enabled", True) is not False
    whatsapp_entitled = bool(whatsapp_in_plan and whatsapp_tenant_enabled)
    whatsapp_available = bool(whatsapp_entitled and whatsapp_configured)

    connection: dict[str, Any] = {
        "state": "NOT_CONFIGURED",
        "pairing_code": None,
        "qr_base64": None,
        "number": None,
        "profile_name": None,
        "session_exists": False,
    }
    operations_available = False
    if whatsapp_available:
        try:
            service = await managed_whatsapp(context)
            operations_available = service.managed_instance
            connection = await _provider_snapshot(service)
        except (APIError, httpx.HTTPError):
            connection["state"] = "UNAVAILABLE"

    email_in_plan = features.get("email", True) is not False
    email_tenant_enabled = features.get("email_enabled", True) is not False
    email_entitled = bool(email_in_plan and email_tenant_enabled)

    nfse_in_plan = bool(features.get("nfse", False))
    nfse_nacional_in_plan = bool(features.get("nfse_nacional", nfse_in_plan)) and nfse_in_plan
    nfse_webiss_in_plan = bool(features.get("nfse_webiss", False)) and nfse_in_plan
    nfse_nacional_configured = bool(nfse_nacional_global and nfse_nacional_global.is_enabled)
    nfse_webiss_configured = bool(nfse_webiss_global and nfse_webiss_global.is_enabled)

    custom_in_plan = bool(features.get("custom_integrations_allowed", False))
    custom_enabled = features.get("custom_integrations_enabled", True) is not False
    custom_effective = bool(custom_in_plan and custom_enabled)

    return SuccessResponse(
        data={
            "whatsapp": {
                "label": "WhatsApp",
                "managed": True,
                "included_in_plan": whatsapp_in_plan,
                "enabled_for_tenant": whatsapp_tenant_enabled,
                "entitled": whatsapp_entitled,
                "available": whatsapp_available,
                "configured_by_platform": whatsapp_configured,
                "operations_available": operations_available,
                "connection": connection,
                "billing_mode": str(features.get("whatsapp_billing_mode", "INCLUDED")),
                "monthly_price": features.get("whatsapp_monthly_price"),
            },
            "email": {
                "label": "E-mail",
                "managed": True,
                "included_in_plan": email_in_plan,
                "enabled_for_tenant": email_tenant_enabled,
                "entitled": email_entitled,
                "available": bool(email_entitled and email_configured),
                "configured_by_platform": email_configured,
            },
            "nfse": {
                "label": "NFS-e",
                "managed": True,
                "included_in_plan": nfse_in_plan,
                "portal_nacional": nfse_nacional_in_plan,
                "portal_nacional_configured": nfse_nacional_configured,
                "webiss": nfse_webiss_in_plan,
                "webiss_configured": nfse_webiss_configured,
            },
            "custom_integrations_allowed": custom_effective,
            "custom_integrations": {
                "included_in_plan": custom_in_plan,
                "enabled_for_tenant": custom_enabled,
                "available": custom_effective,
            },
        }
    )


async def _operate(
    context: TenantContext,
    session: AsyncSession,
    user: AuthUser,
    action: str,
    phone: str | None = None,
    company_id: UUID | None = None,
) -> dict[str, Any]:
    configured, included, _, service = await _tenant_whatsapp_available(context)
    if not included:
        raise APIError(
            "WHATSAPP_NOT_INCLUDED",
            "WhatsApp não está habilitado para este plano ou foi desativado para a conta.",
            403,
        )
    if not configured or service is None:
        raise APIError(
            "WHATSAPP_NOT_CONFIGURED",
            "Serviço de WhatsApp ainda não está configurado pela plataforma.",
            424,
        )
    if not service.managed_instance:
        raise APIError(
            "WHATSAPP_SHARED_INSTANCE",
            "Esta conta usa conexão compartilhada e não pode administrá-la individualmente.",
            409,
        )

    normalized_phone = phone
    if action == "connect" and phone:
        company = await _company_for_pairing(session, company_id)
        normalized_phone = normalize_brazil_phone(
            phone,
            company=company,
            field_name="número usado no pareamento do WhatsApp",
        )

    try:
        if action == "create":
            raw = await service.provider.create_instance()
        elif action == "connect":
            raw = await service.provider.connect_instance(normalized_phone)
        elif action == "disconnect":
            raw = await service.provider.disconnect_instance()
        elif action == "restart":
            raw = await service.provider.restart_instance()
        elif action == "delete":
            raw = await service.provider.delete_instance()
        else:
            raise APIError("WHATSAPP_ACTION_INVALID", "Ação de WhatsApp inválida.", 422)
    except httpx.HTTPError as exc:
        raise APIError(
            "WHATSAPP_SERVICE_UNAVAILABLE",
            "O serviço de WhatsApp está temporariamente indisponível.",
            503,
        ) from exc

    operation_payload = _connection_payload(raw)
    try:
        snapshot = await _provider_snapshot(service)
        _merge_connection(operation_payload, snapshot)
        operation_payload["state"] = snapshot["state"]
        operation_payload["session_exists"] = snapshot["session_exists"]
        if snapshot["session_exists"]:
            operation_payload["qr_base64"] = None
            operation_payload["pairing_code"] = None
    except (APIError, httpx.HTTPError):
        pass

    if action == "delete":
        operation_payload.update(
            {
                "state": "NOT_CREATED",
                "number": None,
                "profile_name": None,
                "session_exists": False,
                "qr_base64": None,
                "pairing_code": None,
            }
        )
    elif action == "disconnect":
        operation_payload.update(
            {
                "state": "DISCONNECTED",
                "session_exists": False,
                "qr_base64": None,
                "pairing_code": None,
            }
        )

    await _save_managed_state(
        session,
        state=str(operation_payload.get("state") or "UNKNOWN"),
        actor_id=user.id,
        action=action,
        connection=operation_payload,
    )
    state = str(operation_payload.get("state") or "UNKNOWN")
    return {
        "status": state,
        "connected": state == "CONNECTED",
        "session_preserved": bool(operation_payload.get("session_exists")),
        "normalized_phone": normalized_phone if action == "connect" and normalized_phone else None,
        "qr": {
            "image": operation_payload.get("qr_base64"),
            "code": operation_payload.get("pairing_code"),
        },
        "connection": operation_payload,
    }


@router.get("/platform-services/whatsapp/status", response_model=SuccessResponse[dict])
async def whatsapp_status(
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("integrations.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    configured, included, _, service = await _tenant_whatsapp_available(context)
    if not included:
        raise APIError(
            "WHATSAPP_NOT_INCLUDED",
            "WhatsApp não está habilitado para este plano ou foi desativado para a conta.",
            403,
        )
    if not configured or service is None:
        raise APIError(
            "WHATSAPP_NOT_CONFIGURED",
            "Serviço de WhatsApp ainda não está configurado pela plataforma.",
            424,
        )
    connection = await _provider_snapshot(service)
    await _save_managed_state(
        session,
        state=connection["state"],
        actor_id=user.id,
        action="status",
        connection=connection,
    )
    return SuccessResponse(
        data={
            "status": connection["state"],
            "connected": connection["state"] == "CONNECTED",
            "session_preserved": bool(connection.get("session_exists")),
            "connection": connection,
        }
    )


@router.post("/platform-services/whatsapp/create", response_model=SuccessResponse[dict])
async def whatsapp_create(
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await _operate(context, session, user, "create"))


@router.post("/platform-services/whatsapp/connect", response_model=SuccessResponse[dict])
async def whatsapp_connect(
    payload: WhatsAppConnectRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    return SuccessResponse(
        data=await _operate(context, session, user, "connect", payload.phone, payload.company_id)
    )


@router.post("/platform-services/whatsapp/disconnect", response_model=SuccessResponse[dict])
async def whatsapp_disconnect(
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await _operate(context, session, user, "disconnect"))


@router.post("/platform-services/whatsapp/restart", response_model=SuccessResponse[dict])
async def whatsapp_restart(
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await _operate(context, session, user, "restart"))


@router.delete("/platform-services/whatsapp", response_model=SuccessResponse[dict])
async def whatsapp_delete(
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await _operate(context, session, user, "delete"))
