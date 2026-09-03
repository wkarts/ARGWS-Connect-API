from __future__ import annotations

import json
from datetime import UTC, datetime
from zoneinfo import ZoneInfo
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import ORJSONResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    accessible_company_ids,
    current_connect_api_tser,
    ensure_company_access,
    get_tenant_context_dep,
    get_tenant_db,
    require_permission,
)
from app.core.config import settings
from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.core.tenant_context import TenantContext
from app.models.tenant import (
    BankAccount,
    BankAgreement,
    Company,
    IntegrationSetting,
    Notification,
    NotificationRule,
    NotificationTemplate,
    TenantAuditLog,
)
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.schemas.tenant import (
    BankAccountCreate,
    BankAgreementCreate,
    IntegrationSettingInput,
    NotificationRuleInput,
    NotificationTemplateInput,
    NotificationTestRequest,
)
from app.services.audit import tenant_audit
from app.services.collection_rules import CollectionRuleService, validate_rule_events
from app.services.notifications import NotificationService

router = APIRouter(prefix="/api/v1", tags=["Tenant - Integrações"])


@router.get("/context", response_model=SuccessResponse[dict])
async def tenant_context(
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    company = await session.scalar(select(Company).where(Company.is_active.is_(True)).order_by(Company.created_at))
    branding = company.branding if company else {}
    return SuccessResponse(
        data={
            "tenant_id": context.tenant_id,
            "slug": context.slug,
            "hostname": context.hostname,
            "timezone": context.timezone,
            "branding": {
                "name": branding.get("name") or (company.trade_name if company else settings.app_name),
                "logo_url": branding.get("logo_url"),
                "favicon_url": branding.get("favicon_url"),
                "primary_color": branding.get("primary_color") or "#0f766e",
                "secondary_color": branding.get("secondary_color") or "#0f172a",
            },
        }
    )


@router.get("/manifest.webmanifest", include_in_schema=False)
async def manifest(
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
) -> ORJSONResponse:
    company = await session.scalar(select(Company).where(Company.is_active.is_(True)).order_by(Company.created_at))
    branding = company.branding if company else {}
    name = branding.get("name") or (company.trade_name if company else settings.app_name)
    icons = branding.get("icons") or [
        {"src": "/icons/icon-192.svg", "sizes": "192x192", "type": "image/svg+xml"},
        {"src": "/icons/icon-512.svg", "sizes": "512x512", "type": "image/svg+xml"},
    ]
    return ORJSONResponse(
        content={
            "name": name,
            "short_name": str(name)[:30],
            "description": "Gestão financeira, cobranças e recebíveis",
            "start_url": "/",
            "scope": "/",
            "display": "standalone",
            "background_color": "#f8fafc",
            "theme_color": branding.get("primary_color") or "#0f766e",
            "icons": icons,
        },
        media_type="application/manifest+json",
    )


@router.get("/bank-accounts", response_model=SuccessResponse[list[dict]])
async def list_bank_accounts(
    company_id: UUID | None = Query(default=None),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(BankAccount).where(BankAccount.is_active.is_(True))
    if company_id:
        ensure_company_access(user, company_id)
        stmt = stmt.where(BankAccount.company_id == company_id)
    elif user.role != "TENANT_ADMIN" and "*" not in user.permissions:
        stmt = stmt.where(BankAccount.company_id.in_([UUID(value) for value in user.companies]))
    items = list((await session.execute(stmt.order_by(BankAccount.bank_name))).scalars())
    return SuccessResponse(
        data=[
            {
                "id": str(item.id),
                "company_id": str(item.company_id),
                "bank_code": item.bank_code,
                "bank_name": item.bank_name,
                "branch": item.branch,
                "account": item.account,
                "account_digit": item.account_digit,
                "is_default": item.is_default,
            }
            for item in items
        ]
    )


@router.post("/bank-accounts", response_model=SuccessResponse[dict], status_code=201)
async def create_bank_account(
    payload: BankAccountCreate,
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    ensure_company_access(user, payload.company_id)
    if await session.get(Company, payload.company_id) is None:
        raise APIError("COMPANY_NOT_FOUND", "Empresa não encontrada.", 404)
    if payload.is_default:
        for current in (await session.execute(
            select(BankAccount).where(BankAccount.company_id == payload.company_id, BankAccount.is_default.is_(True))
        )).scalars():
            current.is_default = False
    item = BankAccount(**payload.model_dump())
    session.add(item)
    await session.flush()
    await tenant_audit(
        session,
        action="bank_account.created",
        entity_type="BankAccount",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        after={"bank_code": item.bank_code, "branch": item.branch, "account": "***" + item.account[-4:]},
    )
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "bank_code": item.bank_code, "bank_name": item.bank_name})


@router.get("/bank-agreements", response_model=SuccessResponse[list[dict]])
async def list_bank_agreements(
    company_id: UUID | None = Query(default=None),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(BankAgreement).where(BankAgreement.is_active.is_(True))
    if company_id:
        ensure_company_access(user, company_id)
        stmt = stmt.where(BankAgreement.company_id == company_id)
    elif user.role != "TENANT_ADMIN" and "*" not in user.permissions:
        stmt = stmt.where(BankAgreement.company_id.in_([UUID(value) for value in user.companies]))
    items = list((await session.execute(stmt.order_by(BankAgreement.name))).scalars())
    return SuccessResponse(
        data=[
            {
                "id": str(item.id),
                "company_id": str(item.company_id),
                "bank_account_id": str(item.bank_account_id),
                "name": item.name,
                "provider": item.provider,
                "environment": item.environment,
                "agreement_number": item.agreement_number,
                "wallet": item.wallet,
                "cnab_layout": item.cnab_layout,
                "is_active": item.is_active,
            }
            for item in items
        ]
    )


@router.post("/bank-agreements", response_model=SuccessResponse[dict], status_code=201)
async def create_bank_agreement(
    payload: BankAgreementCreate,
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    ensure_company_access(user, payload.company_id)
    account = await session.get(BankAccount, payload.bank_account_id)
    if account is None or account.company_id != payload.company_id:
        raise APIError("BANK_ACCOUNT_NOT_FOUND", "Conta bancária não encontrada para esta empresa.", 404)
    values = payload.model_dump(exclude={"credentials"})
    item = BankAgreement(
        **values,
        encrypted_credentials=secret_cipher.encrypt(json.dumps(payload.credentials, ensure_ascii=False)),
    )
    session.add(item)
    await session.flush()
    await tenant_audit(
        session,
        action="bank_agreement.created",
        entity_type="BankAgreement",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        after={"provider": item.provider, "environment": item.environment, "cnab_layout": item.cnab_layout},
    )
    await session.commit()
    return SuccessResponse(data={"id": str(item.id), "provider": item.provider, "name": item.name})


@router.get("/integrations", response_model=SuccessResponse[list[dict]])
async def list_integrations(
    user: AuthUser = Depends(require_permission("integrations.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(IntegrationSetting)
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        stmt = stmt.where(
            or_(
                IntegrationSetting.company_id.in_(company_ids),
                IntegrationSetting.company_id.is_(None),
            )
        )
    items = list((await session.execute(stmt.order_by(IntegrationSetting.provider))).scalars())
    return SuccessResponse(
        data=[
            {
                "id": str(item.id),
                "scope": item.scope,
                "company_id": str(item.company_id) if item.company_id else None,
                "provider": item.provider,
                "is_enabled": item.is_enabled,
                "public_config": item.public_config,
                "has_secrets": bool(item.encrypted_secrets),
                "last_health_status": item.last_health_status,
                "last_health_at": item.last_health_at.isoformat() if item.last_health_at else None,
                "last_error": item.last_error,
            }
            for item in items
        ]
    )


@router.put("/integrations/{provider}", response_model=SuccessResponse[dict])
async def upsert_integration(
    provider: str,
    payload: IntegrationSettingInput,
    user: AuthUser = Depends(require_permission("integrations.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    provider = provider.upper()
    scope = payload.scope.upper()
    if payload.company_id:
        ensure_company_access(user, payload.company_id)
    elif scope in {"TENANT", "PLATFORM"} and user.role != "TENANT_ADMIN" and "*" not in user.permissions:
        raise APIError(
            "TENANT_INTEGRATION_ADMIN_REQUIRED",
            "Somente o administrador do tenant pode alterar integrações compartilhadas.",
            403,
        )
    item = await session.scalar(
        select(IntegrationSetting).where(
            IntegrationSetting.provider == provider,
            IntegrationSetting.company_id == payload.company_id,
            IntegrationSetting.scope == scope,
        )
    )
    if item is None:
        item = IntegrationSetting(
            scope=scope,
            company_id=payload.company_id,
            provider=provider,
        )
        session.add(item)
    item.is_enabled = payload.is_enabled
    item.public_config = payload.public_config
    if payload.secrets:
        item.encrypted_secrets = secret_cipher.encrypt(json.dumps(payload.secrets, ensure_ascii=False))
    await session.flush()
    await tenant_audit(
        session,
        action="integration.updated",
        entity_type="IntegrationSetting",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id) if item.company_id else None,
        after={"provider": provider, "scope": item.scope, "is_enabled": item.is_enabled},
    )
    await session.commit()
    return SuccessResponse(
        data={"id": str(item.id), "provider": item.provider, "is_enabled": item.is_enabled, "has_secrets": bool(item.encrypted_secrets)}
    )



def serialize_notification_rule(item: NotificationRule) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "events": item.events,
        "is_default": item.is_default,
        "is_active": item.is_active,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


def serialize_notification_template(item: NotificationTemplate) -> dict:
    return {
        "id": str(item.id),
        "code": item.code,
        "channel": item.channel,
        "subject": item.subject,
        "body": item.body,
        "is_active": item.is_active,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


async def ensure_rule_templates(
    session: AsyncSession,
    events: list[dict],
) -> list[dict]:
    try:
        normalized = validate_rule_events(events)
    except ValueError as exc:
        raise APIError("INVALID_NOTIFICATION_RULE", str(exc), 422) from exc
    pairs = {(item["template"], channel) for item in normalized for channel in item["channels"]}
    rows = list((await session.execute(
        select(NotificationTemplate.code, NotificationTemplate.channel).where(
            NotificationTemplate.is_active.is_(True)
        )
    )).all())
    available = {(str(code).upper(), str(channel).upper()) for code, channel in rows}
    missing = sorted(pairs - available)
    if missing:
        raise APIError(
            "NOTIFICATION_TEMPLATE_MISSING",
            "A régua referencia templates ativos inexistentes.",
            422,
            {"missing": [{"code": code, "channel": channel} for code, channel in missing]},
        )
    return normalized


async def notification_template_is_referenced(
    session: AsyncSession,
    *,
    code: str,
    channel: str,
) -> bool:
    rules = list((await session.scalars(
        select(NotificationRule).where(NotificationRule.is_active.is_(True))
    )).all())
    target = (code.upper(), channel.upper())
    for rule in rules:
        try:
            events = validate_rule_events(rule.events)
        except ValueError:
            continue
        for event in events:
            for event_channel in event["channels"]:
                if (event["template"], event_channel) == target:
                    return True
    return False


@router.get("/notification-rules", response_model=SuccessResponse[list[dict]])
async def list_notification_rules(
    _: AuthUser = Depends(require_permission("notifications.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(
        select(NotificationRule).order_by(NotificationRule.is_default.desc(), NotificationRule.name)
    )).all())
    return SuccessResponse(data=[serialize_notification_rule(item) for item in items])


@router.post("/notification-rules", response_model=SuccessResponse[dict], status_code=201)
async def create_notification_rule(
    payload: NotificationRuleInput,
    user: AuthUser = Depends(require_permission("notifications.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    events = await ensure_rule_templates(session, [item.model_dump() for item in payload.events])
    if payload.is_default and not payload.is_active:
        raise APIError("DEFAULT_RULE_MUST_BE_ACTIVE", "A régua padrão precisa estar ativa.", 422)
    if payload.is_default:
        for current in (await session.scalars(
            select(NotificationRule).where(NotificationRule.is_default.is_(True))
        )).all():
            current.is_default = False
    item = NotificationRule(
        name=payload.name,
        events=events,
        is_default=payload.is_default,
        is_active=payload.is_active,
    )
    session.add(item)
    await session.flush()
    await tenant_audit(
        session,
        action="notification_rule.created",
        entity_type="NotificationRule",
        entity_id=str(item.id),
        actor_id=user.id,
        after=serialize_notification_rule(item),
    )
    await session.commit()
    return SuccessResponse(data=serialize_notification_rule(item))


@router.post("/notification-rules/run", response_model=SuccessResponse[dict])
async def run_notification_rules(
    user: AuthUser = Depends(require_permission("notifications.manage")),
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    company_ids = accessible_company_ids(user)
    today = datetime.now(ZoneInfo(context.timezone)).date()
    queued = await CollectionRuleService(session).schedule_due(
        today=today,
        public_base_url=f"{settings.public_scheme}://{context.hostname}",
        company_ids=company_ids,
    )
    await tenant_audit(
        session,
        action="notification_rule.executed",
        entity_type="NotificationRule",
        actor_id=user.id,
        after={"date": today.isoformat(), "queued": queued},
    )
    await session.commit()
    return SuccessResponse(data={"date": today.isoformat(), "queued": queued})


@router.put("/notification-rules/{rule_id}", response_model=SuccessResponse[dict])
async def update_notification_rule(
    rule_id: UUID,
    payload: NotificationRuleInput,
    user: AuthUser = Depends(require_permission("notifications.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(NotificationRule, rule_id)
    if item is None:
        raise APIError("NOTIFICATION_RULE_NOT_FOUND", "Régua de cobrança não encontrada.", 404)
    events = await ensure_rule_templates(session, [event.model_dump() for event in payload.events])
    before = serialize_notification_rule(item)
    if payload.is_default and not payload.is_active:
        raise APIError("DEFAULT_RULE_MUST_BE_ACTIVE", "A régua padrão precisa estar ativa.", 422)
    if item.is_default and (not payload.is_default or not payload.is_active):
        raise APIError(
            "DEFAULT_RULE_REQUIRED",
            "Defina outra régua ativa como padrão antes de alterar esta condição.",
            422,
        )
    if payload.is_default:
        for current in (await session.scalars(
            select(NotificationRule).where(
                NotificationRule.is_default.is_(True),
                NotificationRule.id != item.id,
            )
        )).all():
            current.is_default = False
    item.name = payload.name
    item.events = events
    item.is_default = payload.is_default
    item.is_active = payload.is_active
    await tenant_audit(
        session,
        action="notification_rule.updated",
        entity_type="NotificationRule",
        entity_id=str(item.id),
        actor_id=user.id,
        before=before,
        after=serialize_notification_rule(item),
    )
    await session.commit()
    return SuccessResponse(data=serialize_notification_rule(item))


@router.delete("/notification-rules/{rule_id}", response_model=SuccessResponse[dict])
async def deactivate_notification_rule(
    rule_id: UUID,
    user: AuthUser = Depends(require_permission("notifications.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(NotificationRule, rule_id)
    if item is None:
        raise APIError("NOTIFICATION_RULE_NOT_FOUND", "Régua de cobrança não encontrada.", 404)
    if item.is_default:
        raise APIError("DEFAULT_RULE_REQUIRED", "A régua padrão não pode ser desativada.", 422)
    item.is_active = False
    await tenant_audit(
        session,
        action="notification_rule.deactivated",
        entity_type="NotificationRule",
        entity_id=str(item.id),
        actor_id=user.id,
    )
    await session.commit()
    return SuccessResponse(data=serialize_notification_rule(item))


@router.get("/notification-templates", response_model=SuccessResponse[list[dict]])
async def list_notification_templates(
    _: AuthUser = Depends(require_permission("notifications.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    items = list((await session.scalars(
        select(NotificationTemplate).order_by(NotificationTemplate.code, NotificationTemplate.channel)
    )).all())
    return SuccessResponse(data=[serialize_notification_template(item) for item in items])


@router.post("/notification-templates", response_model=SuccessResponse[dict], status_code=201)
async def create_notification_template(
    payload: NotificationTemplateInput,
    user: AuthUser = Depends(require_permission("notifications.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    existing = await session.scalar(
        select(NotificationTemplate.id).where(
            NotificationTemplate.code == payload.code,
            NotificationTemplate.channel == payload.channel,
        )
    )
    if existing:
        raise APIError("NOTIFICATION_TEMPLATE_EXISTS", "Já existe template para este código e canal.", 409)
    item = NotificationTemplate(**payload.model_dump())
    session.add(item)
    await session.flush()
    await tenant_audit(
        session,
        action="notification_template.created",
        entity_type="NotificationTemplate",
        entity_id=str(item.id),
        actor_id=user.id,
        after=serialize_notification_template(item),
    )
    await session.commit()
    return SuccessResponse(data=serialize_notification_template(item))


@router.put("/notification-templates/{template_id}", response_model=SuccessResponse[dict])
async def update_notification_template(
    template_id: UUID,
    payload: NotificationTemplateInput,
    user: AuthUser = Depends(require_permission("notifications.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(NotificationTemplate, template_id)
    if item is None:
        raise APIError("NOTIFICATION_TEMPLATE_NOT_FOUND", "Template não encontrado.", 404)
    changes_identity = item.code != payload.code or item.channel != payload.channel
    disables_template = item.is_active and not payload.is_active
    if (changes_identity or disables_template) and await notification_template_is_referenced(
        session,
        code=item.code,
        channel=item.channel,
    ):
        raise APIError(
            "NOTIFICATION_TEMPLATE_IN_USE",
            "O template está vinculado a uma régua ativa. Altere a régua antes de modificar código, canal ou status.",
            409,
        )
    conflict = await session.scalar(
        select(NotificationTemplate.id).where(
            NotificationTemplate.code == payload.code,
            NotificationTemplate.channel == payload.channel,
            NotificationTemplate.id != item.id,
        )
    )
    if conflict:
        raise APIError("NOTIFICATION_TEMPLATE_EXISTS", "Já existe template para este código e canal.", 409)
    before = serialize_notification_template(item)
    item.code = payload.code
    item.channel = payload.channel
    item.subject = payload.subject
    item.body = payload.body
    item.is_active = payload.is_active
    await tenant_audit(
        session,
        action="notification_template.updated",
        entity_type="NotificationTemplate",
        entity_id=str(item.id),
        actor_id=user.id,
        before=before,
        after=serialize_notification_template(item),
    )
    await session.commit()
    return SuccessResponse(data=serialize_notification_template(item))


@router.delete("/notification-templates/{template_id}", response_model=SuccessResponse[dict])
async def deactivate_notification_template(
    template_id: UUID,
    user: AuthUser = Depends(require_permission("notifications.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(NotificationTemplate, template_id)
    if item is None:
        raise APIError("NOTIFICATION_TEMPLATE_NOT_FOUND", "Template não encontrado.", 404)
    if await notification_template_is_referenced(session, code=item.code, channel=item.channel):
        raise APIError(
            "NOTIFICATION_TEMPLATE_IN_USE",
            "O template está vinculado a uma régua ativa. Altere a régua antes de desativá-lo.",
            409,
        )
    item.is_active = False
    await tenant_audit(
        session,
        action="notification_template.deactivated",
        entity_type="NotificationTemplate",
        entity_id=str(item.id),
        actor_id=user.id,
    )
    await session.commit()
    return SuccessResponse(data=serialize_notification_template(item))


@router.post("/notifications/test", response_model=SuccessResponse[dict])
async def test_notification(
    payload: NotificationTestRequest,
    user: AuthUser = Depends(require_permission("notifications.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    if payload.company_id:
        ensure_company_access(user, payload.company_id)
    elif accessible_company_ids(user) is not None:
        raise APIError(
            "COMPANY_REQUIRED",
            "Informe uma empresa acessível para testar a notificação.",
            422,
        )
    service = NotificationService(session)
    item = await service.queue(
        channel=payload.channel,
        destination=payload.destination,
        body=payload.body,
        subject=payload.subject,
        company_id=str(payload.company_id) if payload.company_id else None,
    )
    await service.dispatch(item)
    return SuccessResponse(
        data={"id": str(item.id), "status": item.status, "external_id": item.external_id, "error": item.last_error}
    )


@router.get("/notifications", response_model=SuccessResponse[list[dict]])
async def list_notifications(
    status: str | None = Query(default=None),
    user: AuthUser = Depends(require_permission("notifications.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(Notification)
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        stmt = stmt.where(Notification.company_id.in_(company_ids))
    if status:
        stmt = stmt.where(Notification.status == status.upper())
    items = list((await session.execute(stmt.order_by(Notification.created_at.desc()).limit(500))).scalars())
    return SuccessResponse(
        data=[
            {
                "id": str(item.id),
                "company_id": str(item.company_id) if item.company_id else None,
                "customer_id": str(item.customer_id) if item.customer_id else None,
                "receivable_id": str(item.receivable_id) if item.receivable_id else None,
                "channel": item.channel,
                "provider": item.provider,
                "destination": item.destination,
                "subject": item.subject,
                "body": item.body,
                "status": item.status,
                "external_id": item.external_id,
                "attempts": item.attempts,
                "scheduled_at": item.scheduled_at.isoformat(),
                "sent_at": item.sent_at.isoformat() if item.sent_at else None,
                "delivered_at": item.delivered_at.isoformat() if item.delivered_at else None,
                "read_at": item.read_at.isoformat() if item.read_at else None,
                "created_at": item.created_at.isoformat(),
                "last_error": item.last_error,
            }
            for item in items
        ]
    )


@router.get("/audit", response_model=SuccessResponse[list[dict]])
async def list_audit(
    limit: int = Query(default=100, ge=1, le=1000),
    user: AuthUser = Depends(require_permission("audit.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(TenantAuditLog)
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        stmt = stmt.where(TenantAuditLog.company_id.in_(company_ids))
    items = list((await session.execute(stmt.order_by(TenantAuditLog.created_at.desc()).limit(limit))).scalars())
    return SuccessResponse(
        data=[
            {
                "id": str(item.id),
                "action": item.action,
                "entity_type": item.entity_type,
                "entity_id": item.entity_id,
                "actor_id": str(item.actor_id) if item.actor_id else None,
                "company_id": str(item.company_id) if item.company_id else None,
                "created_at": item.created_at.isoformat(),
                "context": item.context,
            }
            for item in items
        ]
    )
