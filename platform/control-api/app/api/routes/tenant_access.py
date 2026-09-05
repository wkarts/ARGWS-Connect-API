from __future__ import annotations

import secrets
from datetime import UTC, datetime, date
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_tenant_db, require_permission, get_tenant_entitlements
from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.core.security import generate_api_key
from app.models.tenant import TenantRole, TenantApiKey, OutboundWebhook, WebhookDelivery, Company
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.schemas.tenant_management import RoleInput, ApiKeyInput, OutboundWebhookInput
from app.services.audit import tenant_audit
from app.services.entitlements import TenantEntitlements
from app.services.outbound_webhooks import OutboundWebhookService

router = APIRouter(prefix="/api/v1", tags=["Connect|API - Acesso e integrações"])

def _grant_permissions(user: AuthUser, permissions: list[str]) -> None:
    if "*" not in user.permissions and not set(permissions).issubset(user.permissions):
        raise APIError("PERMISSION_GRANT_DENIED", "Não é permitido conceder permissões superiores às da sua conta.", 403)


def _iso(value: datetime | date | None) -> str | None:
    return value.isoformat() if value else None

def _role_dict(item: TenantRole) -> dict:
    return {
        "id": str(item.id),
        "code": item.code,
        "name": item.name,
        "description": item.description,
        "permissions": item.permissions,
        "is_system": item.is_system,
        "is_active": item.is_active,
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


def _api_key_dict(item: TenantApiKey) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "key_prefix": item.key_prefix,
        "permissions": item.permissions,
        "company_ids": item.company_ids,
        "allowed_ips": item.allowed_ips,
        "expires_at": _iso(item.expires_at),
        "last_used_at": _iso(item.last_used_at),
        "revoked_at": _iso(item.revoked_at),
        "is_active": item.is_active,
        "created_at": _iso(item.created_at),
    }


def _webhook_dict(item: OutboundWebhook) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "url": item.url,
        "events": item.events,
        "headers": item.headers,
        "timeout_seconds": item.timeout_seconds,
        "max_attempts": item.max_attempts,
        "has_secret": bool(item.encrypted_secret),
        "is_active": item.is_active,
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


@router.get("/roles", response_model=SuccessResponse[list[dict]])
async def list_roles(
    _: AuthUser = Depends(require_permission("users.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(select(TenantRole).order_by(TenantRole.is_system.desc(), TenantRole.name))).all())
    return SuccessResponse(data=[_role_dict(item) for item in items])


@router.post("/roles", response_model=SuccessResponse[dict], status_code=201)
async def create_role(
    payload: RoleInput,
    user: AuthUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    _grant_permissions(user, payload.permissions)
    if await session.scalar(select(TenantRole.id).where(TenantRole.code == payload.code)):
        raise APIError("ROLE_EXISTS", "Já existe um perfil com este código.", 409)
    item = TenantRole(**payload.model_dump(), is_system=False)
    session.add(item)
    await session.flush()
    await tenant_audit(session, action="role.created", entity_type="TenantRole", entity_id=str(item.id), actor_id=user.id, after=payload.model_dump(mode="json"))
    await session.commit()
    return SuccessResponse(data=_role_dict(item))


@router.patch("/roles/{role_id}", response_model=SuccessResponse[dict])
async def update_role(
    role_id: UUID,
    payload: RoleInput,
    user: AuthUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    _grant_permissions(user, payload.permissions)
    item = await session.get(TenantRole, role_id)
    if item is None:
        raise APIError("ROLE_NOT_FOUND", "Perfil não encontrado.", 404)
    if item.is_system and payload.code != item.code:
        raise APIError("SYSTEM_ROLE_CODE_LOCKED", "O código de um perfil de sistema não pode ser alterado.", 409)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await tenant_audit(session, action="role.updated", entity_type="TenantRole", entity_id=str(item.id), actor_id=user.id, after=payload.model_dump(mode="json"))
    await session.commit()
    return SuccessResponse(data=_role_dict(item))


@router.delete("/roles/{role_id}", response_model=SuccessResponse[dict])
async def delete_role(
    role_id: UUID,
    user: AuthUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(TenantRole, role_id)
    if item is None:
        raise APIError("ROLE_NOT_FOUND", "Perfil não encontrado.", 404)
    if item.is_system:
        item.is_active = False
    else:
        await session.delete(item)
    await tenant_audit(session, action="role.deleted", entity_type="TenantRole", entity_id=str(role_id), actor_id=user.id)
    await session.commit()
    return SuccessResponse(data={"deleted": not item.is_system, "deactivated": item.is_system})


@router.get("/api-keys", response_model=SuccessResponse[list[dict]])
async def list_api_keys(
    _: AuthUser = Depends(require_permission("integrations.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(select(TenantApiKey).order_by(TenantApiKey.created_at.desc()))).all())
    return SuccessResponse(data=[_api_key_dict(item) for item in items])


@router.post("/api-keys", response_model=SuccessResponse[dict], status_code=201)
async def create_api_key(
    payload: ApiKeyInput,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    _grant_permissions(user, payload.permissions)
    if "*" not in user.permissions and (not payload.company_ids or not {str(v) for v in payload.company_ids}.issubset(user.companies)):
        raise APIError("COMPANY_GRANT_DENIED", "Restrinja a chave às empresas permitidas para sua conta.", 403)
    raw, digest = generate_api_key()
    item = TenantApiKey(name=payload.name, key_prefix=raw[:12], key_hash=digest, permissions=payload.permissions, company_ids=[str(value) for value in payload.company_ids], allowed_ips=payload.allowed_ips, expires_at=payload.expires_at, is_active=True)
    session.add(item)
    await session.flush()
    await tenant_audit(session, action="api_key.created", entity_type="TenantApiKey", entity_id=str(item.id), actor_id=user.id, after={"name": item.name, "key_prefix": item.key_prefix, "permissions": item.permissions})
    await session.commit()
    return SuccessResponse(data={**_api_key_dict(item), "api_key": raw, "warning": "A chave completa é exibida somente nesta resposta."})


@router.delete("/api-keys/{key_id}", response_model=SuccessResponse[dict])
async def revoke_api_key(
    key_id: UUID,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(TenantApiKey, key_id)
    if item is None:
        raise APIError("API_KEY_NOT_FOUND", "Chave não encontrada.", 404)
    item.is_active = False
    item.revoked_at = datetime.now(UTC)
    await tenant_audit(session, action="api_key.revoked", entity_type="TenantApiKey", entity_id=str(item.id), actor_id=user.id)
    await session.commit()
    return SuccessResponse(data={"revoked": True})


@router.get("/outbound-webhooks", response_model=SuccessResponse[list[dict]])
async def list_outbound_webhooks(
    _: AuthUser = Depends(require_permission("integrations.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(select(OutboundWebhook).order_by(OutboundWebhook.name))).all())
    return SuccessResponse(data=[_webhook_dict(item) for item in items])


@router.post("/outbound-webhooks", response_model=SuccessResponse[dict], status_code=201)
async def create_outbound_webhook(
    payload: OutboundWebhookInput,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    entitlements: TenantEntitlements = Depends(get_tenant_entitlements),
) -> SuccessResponse[dict]:
    entitlements.require_feature("webhooks")
    item = OutboundWebhook(name=payload.name, url=str(payload.url), events=payload.events, encrypted_secret=secret_cipher.encrypt(payload.secret.get_secret_value() if payload.secret else secrets.token_urlsafe(32)), headers=payload.headers, timeout_seconds=payload.timeout_seconds, max_attempts=payload.max_attempts, is_active=payload.is_active)
    session.add(item)
    await session.flush()
    await tenant_audit(session, action="outbound_webhook.created", entity_type="OutboundWebhook", entity_id=str(item.id), actor_id=user.id, after={"name": item.name, "url": item.url, "events": item.events})
    await session.commit()
    return SuccessResponse(data=_webhook_dict(item))


@router.patch("/outbound-webhooks/{webhook_id}", response_model=SuccessResponse[dict])
async def update_outbound_webhook(
    webhook_id: UUID,
    payload: OutboundWebhookInput,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(OutboundWebhook, webhook_id)
    if item is None:
        raise APIError("WEBHOOK_NOT_FOUND", "Webhook não encontrado.", 404)
    item.name = payload.name
    item.url = str(payload.url)
    item.events = payload.events
    item.headers = payload.headers
    item.timeout_seconds = payload.timeout_seconds
    item.max_attempts = payload.max_attempts
    item.is_active = payload.is_active
    if payload.secret:
        item.encrypted_secret = secret_cipher.encrypt(payload.secret.get_secret_value())
    await tenant_audit(session, action="outbound_webhook.updated", entity_type="OutboundWebhook", entity_id=str(item.id), actor_id=user.id, after={"name": item.name, "url": item.url, "events": item.events})
    await session.commit()
    return SuccessResponse(data=_webhook_dict(item))


@router.delete("/outbound-webhooks/{webhook_id}", response_model=SuccessResponse[dict])
async def delete_outbound_webhook(
    webhook_id: UUID,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(OutboundWebhook, webhook_id)
    if item is None:
        raise APIError("WEBHOOK_NOT_FOUND", "Webhook não encontrado.", 404)
    item.is_active = False
    await tenant_audit(session, action="outbound_webhook.disabled", entity_type="OutboundWebhook", entity_id=str(item.id), actor_id=user.id)
    await session.commit()
    return SuccessResponse(data={"disabled": True})


@router.get("/outbound-webhooks/{webhook_id}/deliveries", response_model=SuccessResponse[list[dict]])
async def list_webhook_deliveries(
    webhook_id: UUID,
    _: AuthUser = Depends(require_permission("integrations.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(select(WebhookDelivery).where(WebhookDelivery.webhook_id == webhook_id).order_by(WebhookDelivery.created_at.desc()).limit(500))).all())
    return SuccessResponse(data=[{"id": str(item.id), "event_type": item.event_type, "event_id": item.event_id, "status": item.status, "attempts": item.attempts, "response_status": item.response_status, "next_attempt_at": _iso(item.next_attempt_at), "delivered_at": _iso(item.delivered_at), "last_error": item.last_error, "created_at": _iso(item.created_at)} for item in items])


@router.post("/outbound-webhooks/{webhook_id}/test", response_model=SuccessResponse[dict], status_code=202)
async def test_outbound_webhook(
    webhook_id: UUID,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    webhook = await session.get(OutboundWebhook, webhook_id)
    if webhook is None:
        raise APIError("WEBHOOK_NOT_FOUND", "Webhook não encontrado.", 404)
    delivery = WebhookDelivery(webhook_id=webhook.id, event_type="platform.webhook.test", event_id=secrets.token_hex(16), payload={"message": "Teste de webhook", "requested_by": user.id, "timestamp": datetime.now(UTC).isoformat()}, status="PENDING", next_attempt_at=datetime.now(UTC))
    session.add(delivery)
    await session.commit()
    delivered = await OutboundWebhookService(session).dispatch_pending(limit=1)
    await session.refresh(delivery)
    return SuccessResponse(data={"delivery_id": str(delivery.id), "status": delivery.status, "delivered": bool(delivered), "response_status": delivery.response_status, "last_error": delivery.last_error})



@router.get("/companies", response_model=SuccessResponse[list[dict]])
async def list_companies(
    user: AuthUser = Depends(require_permission("companies.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(Company).order_by(Company.legal_name)
    if "*" not in user.permissions:
        stmt = stmt.where(Company.id.in_([UUID(value) for value in user.companies]))
    rows = list((await session.scalars(stmt)).all())
    return SuccessResponse(data=[{"id": str(row.id), "name": row.trade_name or row.legal_name, "legal_name": row.legal_name, "trade_name": row.trade_name, "tax_id": row.tax_id, "is_active": row.is_active} for row in rows])
