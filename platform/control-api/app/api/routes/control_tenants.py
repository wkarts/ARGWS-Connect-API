from __future__ import annotations

import hmac
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_control_roles
from app.core.config import settings
from app.core.errors import APIError
from app.db.platform import get_platform_session
from app.models.platform import Partner, ProvisioningJob, Tenant, TenantDomain
from app.schemas.auth import AuthUser
from app.schemas.common import PaginatedResponse, PaginationMeta, SuccessResponse
from app.schemas.control import DomainCreate, DomainRead, ProvisioningJobRead, TenantCreate, TenantRead, TenantUpdate
from app.services.audit import platform_audit
from app.services.domains import domain_service
from app.services.entitlements import resolve_plan, synchronize_tenant_entitlements
from app.services.provisioning import provisioning_service
from app.workers.tasks import provision_tenant

router = APIRouter(prefix="/api/control/v1", tags=["Control Plane"])


class DomainBooleanInput(BaseModel):
    enabled: bool


@router.get("/dashboard", response_model=SuccessResponse[dict])
async def dashboard(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    totals = {
        "tenants": await session.scalar(select(func.count()).select_from(Tenant)) or 0,
        "active": await session.scalar(select(func.count()).select_from(Tenant).where(Tenant.status == "ACTIVE")) or 0,
        "provisioning": await session.scalar(
            select(func.count()).select_from(Tenant).where(Tenant.status == "PROVISIONING")
        ) or 0,
        "failed": await session.scalar(
            select(func.count()).select_from(Tenant).where(Tenant.status == "PROVISIONING_FAILED")
        ) or 0,
        "domains": await session.scalar(select(func.count()).select_from(TenantDomain)) or 0,
    }
    return SuccessResponse(data=totals)


@router.get("/tenants", response_model=PaginatedResponse[TenantRead])
async def list_tenants(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    q: str | None = Query(default=None),
    status: str | None = Query(default=None),
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> PaginatedResponse[TenantRead]:
    filters = []
    if q:
        filters.append(Tenant.name.ilike(f"%{q}%") | Tenant.slug.ilike(f"%{q}%"))
    if status:
        filters.append(Tenant.status == status.upper())
    total = await session.scalar(select(func.count()).select_from(Tenant).where(*filters)) or 0
    items = list(
        (
            await session.execute(
                select(Tenant)
                .where(*filters)
                .options(selectinload(Tenant.domains))
                .order_by(Tenant.created_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).scalars()
    )
    pages = (total + per_page - 1) // per_page
    return PaginatedResponse(
        data=[TenantRead.model_validate(item) for item in items],
        meta=PaginationMeta(page=page, per_page=per_page, total=total, pages=pages),
    )


@router.post("/tenants", response_model=SuccessResponse[dict], status_code=201)
async def create_tenant(
    payload: TenantCreate,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    if payload.partner_id is not None and await session.get(Partner, payload.partner_id) is None:
        raise APIError("PARTNER_NOT_FOUND", "Partner não encontrado.", 422)
    if payload.partner_id is not None and payload.branding_mode == "CUSTOM":
        raise APIError("TENANT_BRANDING_INHERITED", "Tenant de Partner deve herdar a identidade do Partner.", 409)
    tenant, job = await provisioning_service.create_request(session, payload, user.id)
    if settings.provisioning_async:
        provision_tenant.delay(str(job.id))
    else:
        await provisioning_service.provision(str(job.id))
    return SuccessResponse(
        data={
            "tenant_id": str(tenant.id),
            "job_id": str(job.id),
            "status": "PROVISIONING" if settings.provisioning_async else "ACTIVE",
            "provisional_domain": settings.tenant_hostname(tenant.slug),
        }
    )


@router.get("/tenants/{tenant_id}", response_model=SuccessResponse[TenantRead])
async def get_tenant(
    tenant_id: UUID,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[TenantRead]:
    tenant = await session.scalar(
        select(Tenant).where(Tenant.id == tenant_id).options(selectinload(Tenant.domains))
    )
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)
    return SuccessResponse(data=TenantRead.model_validate(tenant))


@router.patch("/tenants/{tenant_id}", response_model=SuccessResponse[TenantRead])
async def update_tenant(
    tenant_id: UUID,
    payload: TenantUpdate,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[TenantRead]:
    tenant = await session.scalar(
        select(Tenant).where(Tenant.id == tenant_id).options(selectinload(Tenant.domains))
    )
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)

    before = {
        "name": tenant.name,
        "status": tenant.status,
        "plan_code": tenant.plan_code,
        "features": dict(tenant.features or {}),
        "limits": dict(tenant.limits or {}),
    }
    values = payload.model_dump(exclude_unset=True)
    target_partner_id = values.get("partner_id", tenant.partner_id)
    if target_partner_id is not None and await session.get(Partner, target_partner_id) is None:
        raise APIError("PARTNER_NOT_FOUND", "Partner não encontrado.", 422)
    if target_partner_id is not None and values.get("branding_mode") == "CUSTOM":
        raise APIError("TENANT_BRANDING_INHERITED", "Tenant de Partner deve herdar a identidade do Partner.", 409)
    if target_partner_id is not None:
        values["branding_mode"] = "INHERIT"
        tenant.branding_profile_id = None
    target_plan = await resolve_plan(session, values.get("plan_code") or tenant.plan_code)
    for key, value in values.items():
        if key not in {"plan_code", "features", "limits"}:
            setattr(tenant, key, value)
    if "features" in values and values["features"] is not None:
        tenant.features = dict(values["features"])
    if "limits" in values and values["limits"] is not None:
        tenant.limits = dict(values["limits"])
    tenant.plan_code = target_plan.code
    entitlement_state = await synchronize_tenant_entitlements(session, tenant, plan=target_plan)

    if tenant.status == "ACTIVE" and tenant.activated_at is None:
        tenant.activated_at = datetime.now(UTC)
    await platform_audit(
        session,
        action="tenant.updated",
        entity_type="Tenant",
        entity_id=str(tenant.id),
        actor_id=user.id,
        tenant_id=str(tenant.id),
        before=before,
        after={
            **values,
            "plan_code": target_plan.code,
            "effective_features": entitlement_state["features"],
            "effective_limits": entitlement_state["limits"],
        },
    )
    await session.commit()
    tenant = await session.scalar(
        select(Tenant).where(Tenant.id == tenant_id).options(selectinload(Tenant.domains))
    )
    assert tenant is not None
    return SuccessResponse(data=TenantRead.model_validate(tenant))


@router.post("/tenants/{tenant_id}/provision", response_model=SuccessResponse[dict])
async def retry_provisioning(
    tenant_id: UUID,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)
    previous = await session.scalar(
        select(ProvisioningJob)
        .where(ProvisioningJob.tenant_id == tenant_id)
        .order_by(ProvisioningJob.created_at.desc())
    )
    if previous and previous.status in {"PENDING", "RUNNING"}:
        return SuccessResponse(data={"job_id": str(previous.id), "status": previous.status})
    if previous is None:
        raise APIError("PROVISIONING_PAYLOAD_NOT_FOUND", "Não há payload de provisionamento para repetir.", 409)
    job = ProvisioningJob(
        tenant_id=tenant.id,
        operation="PROVISION",
        status="PENDING",
        current_step="RETRY_CREATED",
        correlation_id=uuid4().hex,
        payload=previous.payload,
    )
    job.add_event("RETRY_CREATED", "Nova tentativa solicitada pelo Control Plane.")
    tenant.status = "PROVISIONING"
    session.add(job)
    await platform_audit(
        session,
        action="tenant.provision.retry_requested",
        entity_type="ProvisioningJob",
        entity_id=str(job.id),
        actor_id=user.id,
        tenant_id=str(tenant.id),
        after={"previous_job_id": str(previous.id), "status": "PENDING"},
        correlation_id=job.correlation_id,
    )
    await session.commit()
    if settings.provisioning_async:
        provision_tenant.delay(str(job.id))
    else:
        await provisioning_service.provision(str(job.id))
    return SuccessResponse(data={"job_id": str(job.id), "status": "PENDING"})


@router.get("/provisioning/{job_id}", response_model=SuccessResponse[ProvisioningJobRead])
async def get_provisioning_job(
    job_id: UUID,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[ProvisioningJobRead]:
    job = await session.get(ProvisioningJob, job_id)
    if job is None:
        raise APIError("PROVISIONING_JOB_NOT_FOUND", "Job não encontrado.", 404)
    return SuccessResponse(data=ProvisioningJobRead.model_validate(job))


@router.post("/tenants/{tenant_id}/domains", response_model=SuccessResponse[DomainRead], status_code=201)
async def add_domain(
    tenant_id: UUID,
    payload: DomainCreate,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[DomainRead]:
    tenant = await session.scalar(
        select(Tenant).where(Tenant.id == tenant_id).options(selectinload(Tenant.domains))
    )
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)
    if tenant.features.get("custom_domain") is False:
        raise APIError("FEATURE_NOT_AVAILABLE", "Domínio personalizado não está habilitado no plano do tenant.", 403)
    domain = await domain_service.add_custom_domain(
        session,
        tenant,
        payload.hostname,
        payload.is_primary,
        management_mode=payload.management_mode,
        zone_name=payload.zone_name,
        dns_proxied=payload.dns_proxied,
    )
    await platform_audit(
        session,
        action="domain.created",
        entity_type="TenantDomain",
        entity_id=str(domain.id),
        actor_id=user.id,
        tenant_id=str(tenant.id),
        after={
            "hostname": domain.hostname,
            "management_mode": domain.management_mode,
            "dns_provider": domain.dns_provider,
            "is_primary": domain.is_primary,
        },
    )
    await session.commit()
    return SuccessResponse(data=DomainRead.model_validate(domain))


@router.get("/domains/{domain_id}/management", response_model=SuccessResponse[dict])
async def domain_management(
    domain_id: UUID,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    domain = await session.get(TenantDomain, domain_id)
    if domain is None:
        raise APIError("DOMAIN_NOT_FOUND", "Domínio não encontrado.", 404)
    return SuccessResponse(data=await domain_service.management_snapshot(domain))


@router.post("/domains/{domain_id}/verify", response_model=SuccessResponse[DomainRead])
async def verify_domain(
    domain_id: UUID,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[DomainRead]:
    domain = await session.get(TenantDomain, domain_id)
    if domain is None:
        raise APIError("DOMAIN_NOT_FOUND", "Domínio não encontrado.", 404)
    domain = await domain_service.verify(session, domain)
    await platform_audit(
        session,
        action="domain.verified",
        entity_type="TenantDomain",
        entity_id=str(domain.id),
        actor_id=user.id,
        tenant_id=str(domain.tenant_id),
        after={"hostname": domain.hostname, "status": domain.status, "ssl_status": domain.ssl_status},
    )
    await session.commit()
    return SuccessResponse(data=DomainRead.model_validate(domain))


@router.post("/domains/{domain_id}/reconcile", response_model=SuccessResponse[DomainRead])
async def reconcile_domain(
    domain_id: UUID,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[DomainRead]:
    domain = await session.get(TenantDomain, domain_id)
    if domain is None:
        raise APIError("DOMAIN_NOT_FOUND", "Domínio não encontrado.", 404)
    before = {"status": domain.status, "last_error": domain.last_error}
    domain = await domain_service.reconcile(session, domain)
    await platform_audit(
        session,
        action="domain.reconciled",
        entity_type="TenantDomain",
        entity_id=str(domain.id),
        actor_id=user.id,
        tenant_id=str(domain.tenant_id),
        before=before,
        after={
            "hostname": domain.hostname,
            "status": domain.status,
            "management_mode": domain.management_mode,
            "dns_provider": domain.dns_provider,
            "dns_proxied": domain.dns_proxied,
            "dnssec_status": domain.dnssec_status,
        },
    )
    await session.commit()
    return SuccessResponse(data=DomainRead.model_validate(domain))


@router.post("/domains/{domain_id}/proxy", response_model=SuccessResponse[DomainRead])
async def update_domain_proxy(
    domain_id: UUID,
    payload: DomainBooleanInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[DomainRead]:
    domain = await session.get(TenantDomain, domain_id)
    if domain is None:
        raise APIError("DOMAIN_NOT_FOUND", "Domínio não encontrado.", 404)
    before = domain.dns_proxied
    domain = await domain_service.set_proxy(session, domain, payload.enabled)
    await platform_audit(
        session,
        action="domain.proxy_updated",
        entity_type="TenantDomain",
        entity_id=str(domain.id),
        actor_id=user.id,
        tenant_id=str(domain.tenant_id),
        before={"proxied": before},
        after={"proxied": domain.dns_proxied},
    )
    await session.commit()
    return SuccessResponse(data=DomainRead.model_validate(domain))


@router.post("/domains/{domain_id}/dnssec", response_model=SuccessResponse[DomainRead])
async def update_domain_dnssec(
    domain_id: UUID,
    payload: DomainBooleanInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[DomainRead]:
    domain = await session.get(TenantDomain, domain_id)
    if domain is None:
        raise APIError("DOMAIN_NOT_FOUND", "Domínio não encontrado.", 404)
    before = domain.dnssec_status
    domain = await domain_service.set_dnssec(session, domain, payload.enabled)
    await platform_audit(
        session,
        action="domain.dnssec_updated",
        entity_type="TenantDomain",
        entity_id=str(domain.id),
        actor_id=user.id,
        tenant_id=str(domain.tenant_id),
        before={"dnssec_status": before},
        after={"dnssec_status": domain.dnssec_status},
    )
    await session.commit()
    return SuccessResponse(data=DomainRead.model_validate(domain))


@router.post("/domains/{domain_id}/ssl-active", response_model=SuccessResponse[DomainRead])
async def mark_ssl_active(
    domain_id: UUID,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[DomainRead]:
    domain = await session.get(TenantDomain, domain_id)
    if domain is None:
        raise APIError("DOMAIN_NOT_FOUND", "Domínio não encontrado.", 404)
    domain = await domain_service.mark_ssl_active(session, domain)
    await platform_audit(
        session,
        action="domain.ssl_activated",
        entity_type="TenantDomain",
        entity_id=str(domain.id),
        actor_id=user.id,
        tenant_id=str(domain.tenant_id),
        after={"hostname": domain.hostname, "status": domain.status, "ssl_status": domain.ssl_status},
    )
    await session.commit()
    return SuccessResponse(data=DomainRead.model_validate(domain))


@router.post("/agent/domains/{hostname}/ssl-active", response_model=SuccessResponse[dict], include_in_schema=False)
async def domain_agent_mark_ssl_active(
    hostname: str,
    x_domain_agent_token: str = Header(default=""),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    if not settings.domain_reconciliation_token or not hmac.compare_digest(
        x_domain_agent_token, settings.domain_reconciliation_token
    ):
        raise APIError("INVALID_AGENT_TOKEN", "Token do agente inválido.", 401)
    normalized = hostname.lower().rstrip(".")
    domain = await session.scalar(select(TenantDomain).where(TenantDomain.hostname == normalized))
    if domain is None:
        raise APIError("DOMAIN_NOT_FOUND", "Domínio não encontrado.", 404)
    domain = await domain_service.mark_ssl_active(session, domain)
    return SuccessResponse(data={"hostname": domain.hostname, "status": domain.status, "ssl_status": domain.ssl_status})


@router.get("/agent/domains", response_model=SuccessResponse[dict], include_in_schema=False)
async def domain_agent_feed(
    x_domain_agent_token: str = Header(default=""),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    if not settings.domain_reconciliation_token or not hmac.compare_digest(
        x_domain_agent_token, settings.domain_reconciliation_token
    ):
        raise APIError("INVALID_AGENT_TOKEN", "Token do agente inválido.", 401)
    domains = list(
        (await session.scalars(
            select(TenantDomain)
            .join(Tenant)
            .where(Tenant.status == "ACTIVE", TenantDomain.domain_type == "CUSTOM")
            .order_by(TenantDomain.hostname)
        )).all()
    )
    return SuccessResponse(
        data={
            "generated_at": datetime.now(UTC).isoformat(),
            "domains": [
                {
                    "hostname": domain.hostname,
                    "status": domain.status,
                    "ssl_status": domain.ssl_status,
                    "management_mode": domain.management_mode,
                    "dns_provider": domain.dns_provider,
                    "dns_target": domain.dns_target,
                    "dns_verified": domain.dns_verified_at is not None,
                }
                for domain in domains
            ],
        }
    )
