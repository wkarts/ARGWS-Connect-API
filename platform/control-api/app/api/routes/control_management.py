from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_control_roles
from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.core.security import create_token, generate_api_key, hash_password
from app.db.platform import get_platform_session
from app.models.platform import (
    BackupRun,
    PlatformApiKey,
    PlatformAuditLog,
    PlatformIntegration,
    PlatformPlan,
    PlatformSetting,
    PlatformUser,
    ProvisioningJob,
    RestoreRun,
    SupportSession,
    Tenant,
    TenantDomain,
    TenantUsageSnapshot,
)
from app.schemas.auth import AuthUser
from app.schemas.common import PaginatedResponse, PaginationMeta, SuccessResponse
from app.schemas.control_management import (
    DomainUpdateInput,
    PlanInput,
    PlanUpdate,
    PlatformApiKeyInput,
    PlatformIntegrationInput,
    PlatformPasswordInput,
    PlatformSettingInput,
    PlatformUserInput,
    PlatformUserUpdate,
    RestoreRequestInput,
    SupportSessionInput,
    TenantLifecycleInput,
)
from app.services.audit import platform_audit
from app.services.domains import domain_service
from app.services.entitlements import synchronize_plan_tenants

router = APIRouter(prefix="/api/control/v1", tags=["Control Plane - Gestão"])


def plan_dict(item: PlatformPlan) -> dict:
    return {
        "id": str(item.id), "code": item.code, "name": item.name,
        "description": item.description, "monthly_price": str(item.monthly_price),
        "annual_price": str(item.annual_price), "features": item.features,
        "limits": item.limits, "sort_order": item.sort_order,
        "is_public": item.is_public, "is_active": item.is_active,
        "created_at": item.created_at.isoformat(), "updated_at": item.updated_at.isoformat(),
    }


def platform_user_dict(item: PlatformUser) -> dict:
    return {
        "id": str(item.id), "name": item.name, "email": item.email,
        "role": item.role, "is_active": item.is_active,
        "last_login_at": item.last_login_at.isoformat() if item.last_login_at else None,
        "created_at": item.created_at.isoformat(), "updated_at": item.updated_at.isoformat(),
    }


def domain_dict(item: TenantDomain, tenant: Tenant | None = None) -> dict:
    return {
        "id": str(item.id),
        "tenant_id": str(item.tenant_id),
        "tenant_name": tenant.name if tenant else None,
        "tenant_slug": tenant.slug if tenant else None,
        "hostname": item.hostname,
        "domain_type": item.domain_type,
        "management_mode": item.management_mode,
        "dns_provider": item.dns_provider,
        "status": item.status,
        "is_primary": item.is_primary,
        "is_temporary": item.is_temporary,
        "redirect_to_primary": item.redirect_to_primary,
        "zone_name": item.zone_name,
        "zone_id": item.zone_id,
        "dns_record_type": item.dns_record_type,
        "dns_target": item.dns_target,
        "dns_proxied": item.dns_proxied,
        "nameservers": list(item.nameservers or []),
        "provider_metadata": dict(item.provider_metadata or {}),
        "dns_verified_at": item.dns_verified_at.isoformat() if item.dns_verified_at else None,
        "ownership_verified_at": item.ownership_verified_at.isoformat() if item.ownership_verified_at else None,
        "last_reconciled_at": item.last_reconciled_at.isoformat() if item.last_reconciled_at else None,
        "dnssec_status": item.dnssec_status,
        "ssl_status": item.ssl_status,
        "ssl_issued_at": item.ssl_issued_at.isoformat() if item.ssl_issued_at else None,
        "last_checked_at": item.last_checked_at.isoformat() if item.last_checked_at else None,
        "last_error": item.last_error,
    }


@router.get("/plans", response_model=SuccessResponse[list[dict]])
async def list_plans(
    include_inactive: bool = False,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    stmt = select(PlatformPlan).order_by(PlatformPlan.sort_order, PlatformPlan.name)
    if not include_inactive:
        stmt = stmt.where(PlatformPlan.is_active.is_(True))
    return SuccessResponse(data=[plan_dict(item) for item in (await session.scalars(stmt)).all()])


@router.post("/plans", response_model=SuccessResponse[dict], status_code=201)
async def create_plan(
    payload: PlanInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    if await session.scalar(select(PlatformPlan).where(PlatformPlan.code == payload.code)):
        raise APIError("PLAN_ALREADY_EXISTS", "Já existe um plano com este código.", 409)
    item = PlatformPlan(**payload.model_dump())
    session.add(item)
    await session.flush()
    await platform_audit(
        session,
        action="plan.created",
        entity_type="PlatformPlan",
        entity_id=str(item.id),
        actor_id=user.id,
        after=payload.model_dump(mode="json"),
    )
    await session.commit()
    return SuccessResponse(data=plan_dict(item))


@router.patch("/plans/{plan_id}", response_model=SuccessResponse[dict])
async def update_plan(
    plan_id: UUID,
    payload: PlanUpdate,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    item = await session.get(PlatformPlan, plan_id)
    if item is None:
        raise APIError("PLAN_NOT_FOUND", "Plano não encontrado.", 404)
    before = plan_dict(item)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await session.flush()
    synchronized = await synchronize_plan_tenants(session, item)
    await platform_audit(
        session,
        action="plan.updated",
        entity_type="PlatformPlan",
        entity_id=str(item.id),
        actor_id=user.id,
        before=before,
        after={
            **payload.model_dump(exclude_unset=True, mode="json"),
            "synchronized_tenants": synchronized,
        },
    )
    await session.commit()
    await session.refresh(item)
    result = plan_dict(item)
    result["synchronized_tenants"] = synchronized
    return SuccessResponse(data=result)


@router.delete("/plans/{plan_id}", response_model=SuccessResponse[dict])
async def deactivate_plan(
    plan_id: UUID,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    item = await session.get(PlatformPlan, plan_id)
    if item is None:
        raise APIError("PLAN_NOT_FOUND", "Plano não encontrado.", 404)
    linked = await session.scalar(select(func.count()).select_from(Tenant).where(Tenant.plan_code == item.code)) or 0
    if linked:
        item.is_active = False
    else:
        await session.delete(item)
    await platform_audit(
        session,
        action="plan.deactivated",
        entity_type="PlatformPlan",
        entity_id=str(plan_id),
        actor_id=user.id,
        after={"linked_tenants": linked},
    )
    await session.commit()
    return SuccessResponse(data={"deleted": not bool(linked), "deactivated": bool(linked)})


@router.get("/platform-users", response_model=SuccessResponse[list[dict]])
async def list_platform_users(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    items = (await session.scalars(select(PlatformUser).order_by(PlatformUser.name))).all()
    return SuccessResponse(data=[platform_user_dict(item) for item in items])


@router.post("/platform-users", response_model=SuccessResponse[dict], status_code=201)
async def create_platform_user(
    payload: PlatformUserInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN", "PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    email = str(payload.email).lower()
    if await session.scalar(select(PlatformUser).where(PlatformUser.email == email)):
        raise APIError("USER_ALREADY_EXISTS", "E-mail já utilizado.", 409)
    item = PlatformUser(
        name=payload.name,
        email=email,
        password_hash=hash_password(payload.password.get_secret_value()),
        role=payload.role.upper(),
        is_active=payload.is_active,
    )
    session.add(item)
    await session.flush()
    await platform_audit(
        session,
        action="platform_user.created",
        entity_type="PlatformUser",
        entity_id=str(item.id),
        actor_id=user.id,
        after={"name": item.name, "email": item.email, "role": item.role},
    )
    await session.commit()
    return SuccessResponse(data=platform_user_dict(item))


@router.patch("/platform-users/{user_id}", response_model=SuccessResponse[dict])
async def update_platform_user(
    user_id: UUID,
    payload: PlatformUserUpdate,
    actor: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN", "PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    item = await session.get(PlatformUser, user_id)
    if item is None:
        raise APIError("USER_NOT_FOUND", "Usuário não encontrado.", 404)
    if str(item.id) == actor.id and payload.is_active is False:
        raise APIError("CANNOT_DISABLE_SELF", "Não é permitido desativar a própria conta.", 409)
    before = platform_user_dict(item)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value.upper() if key == "role" and value else value)
    await platform_audit(
        session,
        action="platform_user.updated",
        entity_type="PlatformUser",
        entity_id=str(item.id),
        actor_id=actor.id,
        before=before,
        after=payload.model_dump(exclude_unset=True),
    )
    await session.commit()
    return SuccessResponse(data=platform_user_dict(item))


@router.post("/platform-users/{user_id}/password", response_model=SuccessResponse[dict])
async def reset_platform_password(
    user_id: UUID,
    payload: PlatformPasswordInput,
    actor: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN", "PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    item = await session.get(PlatformUser, user_id)
    if item is None:
        raise APIError("USER_NOT_FOUND", "Usuário não encontrado.", 404)
    item.password_hash = hash_password(payload.password.get_secret_value())
    item.failed_login_attempts = 0
    item.locked_until = None
    await platform_audit(
        session,
        action="platform_user.password_reset",
        entity_type="PlatformUser",
        entity_id=str(item.id),
        actor_id=actor.id,
    )
    await session.commit()
    return SuccessResponse(data={"updated": True})


@router.get("/settings", response_model=SuccessResponse[list[dict]])
async def list_settings(
    category: str | None = None,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    stmt = select(PlatformSetting).order_by(PlatformSetting.category, PlatformSetting.key)
    if category:
        stmt = stmt.where(PlatformSetting.category == category.upper())
    items = (await session.scalars(stmt)).all()
    return SuccessResponse(data=[{
        "id": str(x.id),
        "key": x.key,
        "category": x.category,
        "value": {} if x.is_secret else x.value,
        "is_secret": x.is_secret,
        "description": x.description,
        "updated_at": x.updated_at.isoformat(),
    } for x in items])


@router.put("/settings/{key}", response_model=SuccessResponse[dict])
async def upsert_setting(
    key: str,
    payload: PlatformSettingInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    normalized = key.strip().upper()
    item = await session.scalar(select(PlatformSetting).where(PlatformSetting.key == normalized))
    value = payload.value
    if item is None:
        item = PlatformSetting(
            key=normalized,
            category=payload.category.upper(),
            value=value,
            is_secret=payload.is_secret,
            description=payload.description,
        )
        session.add(item)
    else:
        item.category = payload.category.upper()
        item.value = value
        item.is_secret = payload.is_secret
        item.description = payload.description
    await session.flush()
    await platform_audit(
        session,
        action="platform_setting.upserted",
        entity_type="PlatformSetting",
        entity_id=str(item.id),
        actor_id=user.id,
        after={"key": normalized, "category": item.category, "is_secret": item.is_secret},
    )
    await session.commit()
    return SuccessResponse(data={
        "id": str(item.id),
        "key": item.key,
        "category": item.category,
        "value": {} if item.is_secret else item.value,
        "is_secret": item.is_secret,
    })


@router.get("/platform-integrations", response_model=SuccessResponse[list[dict]])
async def list_platform_integrations(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    items = (await session.scalars(select(PlatformIntegration).order_by(PlatformIntegration.provider))).all()
    return SuccessResponse(data=[{
        "id": str(x.id),
        "provider": x.provider,
        "is_enabled": x.is_enabled,
        "public_config": x.public_config,
        "has_secrets": bool(x.encrypted_secrets),
        "health_status": x.health_status,
        "health_checked_at": x.health_checked_at.isoformat() if x.health_checked_at else None,
        "last_error": x.last_error,
    } for x in items])


@router.put("/platform-integrations/{provider}", response_model=SuccessResponse[dict])
async def upsert_platform_integration(
    provider: str,
    payload: PlatformIntegrationInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    normalized = provider.strip().upper()
    item = await session.scalar(select(PlatformIntegration).where(PlatformIntegration.provider == normalized))
    encrypted = (
        secret_cipher.encrypt(__import__("json").dumps(payload.secrets))
        if payload.secrets
        else (item.encrypted_secrets if item else "")
    )
    if item is None:
        item = PlatformIntegration(
            provider=normalized,
            is_enabled=payload.is_enabled,
            public_config=payload.public_config,
            encrypted_secrets=encrypted,
        )
        session.add(item)
    else:
        item.is_enabled = payload.is_enabled
        item.public_config = payload.public_config
        item.encrypted_secrets = encrypted
    await session.flush()
    await platform_audit(
        session,
        action="platform_integration.upserted",
        entity_type="PlatformIntegration",
        entity_id=str(item.id),
        actor_id=user.id,
        after={"provider": normalized, "is_enabled": item.is_enabled, "has_secrets": bool(item.encrypted_secrets)},
    )
    await session.commit()
    return SuccessResponse(data={
        "id": str(item.id),
        "provider": item.provider,
        "is_enabled": item.is_enabled,
        "public_config": item.public_config,
        "has_secrets": bool(item.encrypted_secrets),
    })


@router.post("/tenants/{tenant_id}/lifecycle", response_model=SuccessResponse[dict])
async def tenant_lifecycle(
    tenant_id: UUID,
    payload: TenantLifecycleInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)
    before = {"status": tenant.status, "suspended_reason": tenant.suspended_reason}
    mapping = {
        "ACTIVATE": "ACTIVE", "REACTIVATE": "ACTIVE", "SUSPEND": "SUSPENDED",
        "BLOCK": "BLOCKED", "CANCEL": "CANCELLED", "ARCHIVE": "ARCHIVED",
    }
    tenant.status = mapping[payload.action]
    tenant.suspended_reason = payload.reason if tenant.status in {"SUSPENDED", "BLOCKED", "CANCELLED"} else None
    if tenant.status == "ACTIVE":
        tenant.activated_at = tenant.activated_at or datetime.now(UTC)
    if tenant.status == "ARCHIVED":
        tenant.archived_at = datetime.now(UTC)
    await platform_audit(
        session,
        action=f"tenant.{payload.action.lower()}",
        entity_type="Tenant",
        entity_id=str(tenant.id),
        actor_id=user.id,
        tenant_id=str(tenant.id),
        before=before,
        after={"status": tenant.status, "reason": payload.reason},
    )
    await session.commit()
    return SuccessResponse(data={"tenant_id": str(tenant.id), "status": tenant.status})


@router.get("/domains", response_model=SuccessResponse[list[dict]])
async def list_domains(
    tenant_id: UUID | None = None,
    status: str | None = None,
    management_mode: str | None = None,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    stmt = select(TenantDomain, Tenant).join(Tenant, Tenant.id == TenantDomain.tenant_id).order_by(Tenant.name, TenantDomain.hostname)
    if tenant_id:
        stmt = stmt.where(TenantDomain.tenant_id == tenant_id)
    if status:
        stmt = stmt.where(TenantDomain.status == status.upper())
    if management_mode:
        stmt = stmt.where(TenantDomain.management_mode == management_mode.upper())
    rows = list((await session.execute(stmt)).all())
    return SuccessResponse(data=[domain_dict(domain, tenant) for domain, tenant in rows])


@router.patch("/domains/{domain_id}", response_model=SuccessResponse[dict])
async def update_domain(
    domain_id: UUID,
    payload: DomainUpdateInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    item = await session.get(TenantDomain, domain_id)
    if item is None:
        raise APIError("DOMAIN_NOT_FOUND", "Domínio não encontrado.", 404)
    if payload.is_primary:
        others = (await session.scalars(
            select(TenantDomain).where(TenantDomain.tenant_id == item.tenant_id, TenantDomain.id != item.id)
        )).all()
        for other in others:
            other.is_primary = False
    before = domain_dict(item)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value.upper() if key == "status" and value else value)
    await platform_audit(
        session,
        action="domain.updated",
        entity_type="TenantDomain",
        entity_id=str(item.id),
        actor_id=user.id,
        tenant_id=str(item.tenant_id),
        before=before,
        after=payload.model_dump(exclude_unset=True),
    )
    await session.commit()
    return SuccessResponse(data=domain_dict(item))


@router.delete("/domains/{domain_id}", response_model=SuccessResponse[dict])
async def delete_domain(
    domain_id: UUID,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    item = await session.get(TenantDomain, domain_id)
    if item is None:
        raise APIError("DOMAIN_NOT_FOUND", "Domínio não encontrado.", 404)
    if item.is_temporary or item.domain_type == "PROVISIONED":
        raise APIError("PROVISIONED_DOMAIN_REQUIRED", "O domínio provisionado não pode ser removido.", 409)
    if item.is_primary:
        raise APIError("PRIMARY_DOMAIN_CANNOT_DELETE", "Defina outro domínio principal antes de remover este.", 409)
    tenant_id = str(item.tenant_id)
    before = domain_dict(item)
    await domain_service.remove(session, item)
    await platform_audit(
        session,
        action="domain.deleted",
        entity_type="TenantDomain",
        entity_id=str(domain_id),
        actor_id=user.id,
        tenant_id=tenant_id,
        before=before,
    )
    await session.commit()
    return SuccessResponse(data={"deleted": True})


@router.get("/provisioning", response_model=PaginatedResponse[dict])
async def list_provisioning_jobs(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    status: str | None = None,
    tenant_id: UUID | None = None,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> PaginatedResponse[dict]:
    filters = []
    if status:
        filters.append(ProvisioningJob.status == status.upper())
    if tenant_id:
        filters.append(ProvisioningJob.tenant_id == tenant_id)
    total = await session.scalar(select(func.count()).select_from(ProvisioningJob).where(*filters)) or 0
    rows = list((await session.execute(
        select(ProvisioningJob, Tenant)
        .join(Tenant, Tenant.id == ProvisioningJob.tenant_id)
        .where(*filters)
        .order_by(ProvisioningJob.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )).all())
    data = [{
        "id": str(job.id),
        "tenant_id": str(job.tenant_id),
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
        "operation": job.operation,
        "status": job.status,
        "current_step": job.current_step,
        "progress": job.progress,
        "attempts": job.attempts,
        "correlation_id": job.correlation_id,
        "events": job.events,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "last_error": job.last_error,
        "created_at": job.created_at.isoformat(),
    } for job, tenant in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(page=page, per_page=per_page, total=total, pages=(total + per_page - 1) // per_page),
    )


@router.get("/audit", response_model=PaginatedResponse[dict])
async def list_platform_audit(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    action: str | None = None,
    tenant_id: UUID | None = None,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> PaginatedResponse[dict]:
    filters = []
    if action:
        filters.append(PlatformAuditLog.action.ilike(f"%{action}%"))
    if tenant_id:
        filters.append(PlatformAuditLog.tenant_id == tenant_id)
    total = await session.scalar(select(func.count()).select_from(PlatformAuditLog).where(*filters)) or 0
    items = list((await session.scalars(
        select(PlatformAuditLog)
        .where(*filters)
        .order_by(PlatformAuditLog.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )).all())

    actor_ids = {item.actor_id for item in items if item.actor_id}
    tenant_ids = {item.tenant_id for item in items if item.tenant_id}
    actors = {
        item.id: item for item in (
            await session.scalars(select(PlatformUser).where(PlatformUser.id.in_(actor_ids)))
        ).all()
    } if actor_ids else {}
    tenants = {
        item.id: item for item in (
            await session.scalars(select(Tenant).where(Tenant.id.in_(tenant_ids)))
        ).all()
    } if tenant_ids else {}

    data = []
    for item in items:
        actor = actors.get(item.actor_id)
        tenant = tenants.get(item.tenant_id)
        data.append({
            "id": str(item.id),
            "actor_id": str(item.actor_id) if item.actor_id else None,
            "actor_name": actor.name if actor else ("Sistema" if item.actor_id is None else None),
            "actor_email": actor.email if actor else None,
            "tenant_id": str(item.tenant_id) if item.tenant_id else None,
            "tenant_name": tenant.name if tenant else None,
            "tenant_slug": tenant.slug if tenant else None,
            "action": item.action,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "before": item.before,
            "after": item.after,
            "context": item.context,
            "correlation_id": item.correlation_id,
            "created_at": item.created_at.isoformat(),
        })
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(page=page, per_page=per_page, total=total, pages=(total + per_page - 1) // per_page),
    )


@router.get("/tenants/{tenant_id}/usage", response_model=SuccessResponse[dict])
async def connect_api_usage(
    tenant_id: UUID,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)
    snapshots = (await session.scalars(
        select(TenantUsageSnapshot)
        .where(TenantUsageSnapshot.tenant_id == tenant_id)
        .order_by(TenantUsageSnapshot.captured_at.desc())
        .limit(24)
    )).all()
    return SuccessResponse(data={
        "tenant_id": str(tenant_id),
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
        "plan_code": tenant.plan_code,
        "limits": tenant.limits,
        "features": tenant.features,
        "snapshots": [{
            "id": str(x.id), "period": x.period, "metrics": x.metrics, "captured_at": x.captured_at.isoformat()
        } for x in snapshots],
    })


@router.get("/support-sessions", response_model=SuccessResponse[list[dict]])
async def list_support_sessions(
    status: str | None = None,
    tenant_id: UUID | None = None,
    _: AuthUser = Depends(
        require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")
    ),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    stmt = select(SupportSession).order_by(SupportSession.created_at.desc()).limit(500)
    if status:
        stmt = stmt.where(SupportSession.status == status.upper())
    if tenant_id:
        stmt = stmt.where(SupportSession.tenant_id == tenant_id)
    items = (await session.scalars(stmt)).all()
    return SuccessResponse(data=[{
        "id": str(item.id),
        "platform_user_id": str(item.platform_user_id),
        "tenant_id": str(item.tenant_id),
        "reason": item.reason,
        "status": item.status,
        "expires_at": item.expires_at.isoformat(),
        "revoked_at": item.revoked_at.isoformat() if item.revoked_at else None,
        "created_at": item.created_at.isoformat(),
    } for item in items])


@router.post("/support-sessions", response_model=SuccessResponse[dict], status_code=201)
async def create_support_session(
    payload: SupportSessionInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    tenant = await session.get(Tenant, payload.tenant_id)
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)
    raw, token_hash = generate_api_key()
    expires = datetime.now(UTC) + timedelta(minutes=payload.duration_minutes)
    item = SupportSession(
        platform_user_id=UUID(user.id),
        tenant_id=payload.tenant_id,
        reason=payload.reason,
        status="ACTIVE",
        token_hash=token_hash,
        expires_at=expires,
    )
    session.add(item)
    await session.flush()
    access_token = create_token(
        subject=user.id,
        audience="tenant",
        token_type="access",
        tenant_id=str(payload.tenant_id),
        roles=["SUPPORT_IMPERSONATION"],
        expires_delta=timedelta(minutes=payload.duration_minutes),
        extra={"support_session_id": str(item.id)},
    )
    await platform_audit(
        session,
        action="support_session.created",
        entity_type="SupportSession",
        entity_id=str(item.id),
        actor_id=user.id,
        tenant_id=str(payload.tenant_id),
        after={"reason": payload.reason, "expires_at": expires.isoformat()},
    )
    await session.commit()
    return SuccessResponse(data={
        "id": str(item.id),
        "tenant_id": str(item.tenant_id),
        "access_token": access_token,
        "expires_at": expires.isoformat(),
        "one_time_reference": raw[:12],
    })


@router.post("/support-sessions/{session_id}/revoke", response_model=SuccessResponse[dict])
async def revoke_support_session(
    session_id: UUID,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    item = await session.get(SupportSession, session_id)
    if item is None:
        raise APIError("SUPPORT_SESSION_NOT_FOUND", "Sessão de suporte não encontrada.", 404)
    item.status = "REVOKED"
    item.revoked_at = datetime.now(UTC)
    await platform_audit(
        session,
        action="support_session.revoked",
        entity_type="SupportSession",
        entity_id=str(item.id),
        actor_id=user.id,
        tenant_id=str(item.tenant_id),
    )
    await session.commit()
    return SuccessResponse(data={"revoked": True})


@router.post("/restore-runs", response_model=SuccessResponse[dict], status_code=202)
async def request_restore(
    payload: RestoreRequestInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN", "PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    source = payload.source_path
    if payload.backup_run_id:
        backup = await session.get(BackupRun, payload.backup_run_id)
        if backup is None:
            raise APIError("BACKUP_NOT_FOUND", "Backup não encontrado.", 404)
        source = source or backup.path
    if not source:
        raise APIError("RESTORE_SOURCE_REQUIRED", "Informe o backup ou caminho de origem.", 422)
    item = RestoreRun(
        backup_run_id=payload.backup_run_id,
        scope=payload.scope.upper(),
        tenant_id=payload.tenant_id,
        requested_by=UUID(user.id),
        status="VALIDATION_PENDING" if payload.validate_only else "PENDING",
        source_path=source,
        validation={"validate_only": payload.validate_only},
    )
    session.add(item)
    await session.flush()
    await platform_audit(
        session,
        action="restore.requested",
        entity_type="RestoreRun",
        entity_id=str(item.id),
        actor_id=user.id,
        tenant_id=str(payload.tenant_id) if payload.tenant_id else None,
        after={"scope": item.scope, "source": source, "validate_only": payload.validate_only},
    )
    await session.commit()
    return SuccessResponse(data={
        "id": str(item.id), "status": item.status, "requires_maintenance": not payload.validate_only
    })


@router.get("/restore-runs", response_model=SuccessResponse[list[dict]])
async def list_restore_runs(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    items = (await session.scalars(select(RestoreRun).order_by(RestoreRun.created_at.desc()).limit(100))).all()
    return SuccessResponse(data=[{
        "id": str(x.id),
        "backup_run_id": str(x.backup_run_id) if x.backup_run_id else None,
        "scope": x.scope,
        "tenant_id": str(x.tenant_id) if x.tenant_id else None,
        "status": x.status,
        "source_path": x.source_path,
        "validation": x.validation,
        "started_at": x.started_at.isoformat() if x.started_at else None,
        "finished_at": x.finished_at.isoformat() if x.finished_at else None,
        "last_error": x.last_error,
        "created_at": x.created_at.isoformat(),
    } for x in items])


@router.get("/api-keys", response_model=SuccessResponse[list[dict]])
async def list_platform_api_keys(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    items = (await session.scalars(select(PlatformApiKey).order_by(PlatformApiKey.created_at.desc()))).all()
    return SuccessResponse(data=[{
        "id": str(x.id),
        "name": x.name,
        "key_prefix": x.key_prefix,
        "permissions": x.permissions,
        "allowed_ips": x.allowed_ips,
        "expires_at": x.expires_at.isoformat() if x.expires_at else None,
        "last_used_at": x.last_used_at.isoformat() if x.last_used_at else None,
        "is_active": x.is_active,
        "created_at": x.created_at.isoformat(),
    } for x in items])


@router.post("/api-keys", response_model=SuccessResponse[dict], status_code=201)
async def create_platform_api_key(
    payload: PlatformApiKeyInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN", "PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    raw, hashed = generate_api_key()
    item = PlatformApiKey(
        name=payload.name,
        key_prefix=raw[:12],
        key_hash=hashed,
        permissions=payload.permissions,
        allowed_ips=payload.allowed_ips,
        expires_at=payload.expires_at,
        is_active=True,
    )
    session.add(item)
    await session.flush()
    await platform_audit(
        session,
        action="platform_api_key.created",
        entity_type="PlatformApiKey",
        entity_id=str(item.id),
        actor_id=user.id,
        after={"name": item.name, "key_prefix": item.key_prefix, "permissions": item.permissions},
    )
    await session.commit()
    return SuccessResponse(data={
        "id": str(item.id),
        "name": item.name,
        "key": raw,
        "key_prefix": item.key_prefix,
        "warning": "A chave completa é exibida apenas agora.",
    })


@router.delete("/api-keys/{key_id}", response_model=SuccessResponse[dict])
async def revoke_platform_api_key(
    key_id: UUID,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN", "PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    item = await session.get(PlatformApiKey, key_id)
    if item is None:
        raise APIError("API_KEY_NOT_FOUND", "Chave não encontrada.", 404)
    item.is_active = False
    await platform_audit(
        session,
        action="platform_api_key.revoked",
        entity_type="PlatformApiKey",
        entity_id=str(item.id),
        actor_id=user.id,
    )
    await session.commit()
    return SuccessResponse(data={"revoked": True})
