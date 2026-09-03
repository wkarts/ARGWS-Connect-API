from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_control_roles
from app.core.errors import APIError
from app.db.platform import get_platform_session
from app.models.banking_governance import PlatformBankProvider
from app.models.banking_platform import BankInstitution
from app.models.platform import PlatformPlan, Tenant
from app.providers.banking.registry import banking_providers
from app.schemas.auth import AuthUser
from app.schemas.banking import BankInstitutionSyncRequest
from app.schemas.banking_governance import (
    BankProviderGovernanceBulkUpdate,
    BankProviderGovernanceUpdate,
    PlanBankProviderPolicyInput,
    TenantBankProviderPolicyInput,
)
from app.schemas.common import SuccessResponse
from app.services.audit import platform_audit
from app.services.bank_institutions import BankInstitutionCatalogService
from app.services.banking_entitlements import (
    ensure_provider_governance_catalog,
    governance_dict,
    read_plan_policy,
    read_tenant_policy,
    replace_plan_policy,
    replace_tenant_policy,
    tenant_provider_decisions,
)

router = APIRouter(prefix="/api/control/v1/banking", tags=["Control Plane - Banking"])


def institution_dict(item: BankInstitution) -> dict:
    return {
        "id": str(item.id),
        "bank_code": item.bank_code,
        "ispb": item.ispb,
        "cnpj": item.cnpj,
        "legal_name": item.legal_name,
        "short_name": item.short_name,
        "institution_type": item.institution_type,
        "pix_participant": item.pix_participant,
        "str_participant": item.str_participant,
        "active": item.active,
        "source": item.source,
        "source_updated_at": item.source_updated_at.isoformat() if item.source_updated_at else None,
    }


@router.get("/providers", response_model=SuccessResponse[list[dict]])
async def control_banking_providers(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
) -> SuccessResponse[list[dict]]:
    return SuccessResponse(data=[manifest.public_dict() for manifest in banking_providers.manifests()])


@router.get("/support-matrix", response_model=SuccessResponse[list[dict]])
async def control_support_matrix(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
) -> SuccessResponse[list[dict]]:
    return SuccessResponse(data=banking_providers.support_matrix())


@router.get("/providers/governance", response_model=SuccessResponse[list[dict]])
async def control_provider_governance(
    session: AsyncSession = Depends(get_platform_session),
    _: AuthUser = Depends(
        require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")
    ),
) -> SuccessResponse[list[dict]]:
    items = await ensure_provider_governance_catalog(session)
    await session.commit()
    return SuccessResponse(
        data=[
            governance_dict(item, manifest=banking_providers.manifest(item.code))
            for item in sorted(items, key=lambda value: (value.display_name.casefold(), value.code))
        ]
    )


@router.put("/providers/governance/bulk", response_model=SuccessResponse[list[dict]])
async def bulk_update_provider_governance(
    payload: BankProviderGovernanceBulkUpdate,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    await ensure_provider_governance_catalog(session)
    providers = list(dict.fromkeys(payload.providers))
    rows = list(
        (
            await session.scalars(
                select(PlatformBankProvider)
                .where(PlatformBankProvider.code.in_(providers))
                .with_for_update()
            )
        ).all()
    )
    by_code = {item.code: item for item in rows}
    unknown = sorted(set(providers) - set(by_code))
    if unknown:
        raise APIError(
            "BANKING_PROVIDER_UNKNOWN",
            "Há providers inexistentes na operação em massa.",
            404,
            {"providers": unknown},
        )

    unavailable = sorted(
        item.code
        for item in rows
        if not item.driver_installed
        and (payload.globally_enabled is True or payload.tenant_visible is True)
    )
    if unavailable:
        raise APIError(
            "BANKING_PROVIDER_NOT_AVAILABLE",
            "Provider sem executor real não pode ser habilitado nem exposto aos tenants.",
            409,
            {"providers": unavailable},
        )

    before = {
        item.code: {
            "globally_enabled": item.globally_enabled,
            "tenant_visible": item.tenant_visible,
        }
        for item in rows
    }
    for item in rows:
        if payload.globally_enabled is not None:
            item.globally_enabled = payload.globally_enabled
        if payload.tenant_visible is not None:
            item.tenant_visible = payload.tenant_visible

    await session.flush()
    after = {
        item.code: {
            "globally_enabled": item.globally_enabled,
            "tenant_visible": item.tenant_visible,
        }
        for item in rows
    }
    await platform_audit(
        session,
        action="bank.provider.governance.bulk_updated",
        entity_type="PlatformBankProviderSet",
        entity_id="BANK_PROVIDERS",
        actor_id=user.id,
        before=before,
        after=after,
        context={"providers": providers},
    )
    await session.commit()
    return SuccessResponse(
        data=[
            governance_dict(item, manifest=banking_providers.manifest(item.code))
            for item in sorted(rows, key=lambda value: (value.display_name.casefold(), value.code))
        ]
    )


@router.patch("/providers/{provider}/governance", response_model=SuccessResponse[dict])
async def update_provider_governance(
    provider: str,
    payload: BankProviderGovernanceUpdate,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    normalized = provider.strip().upper()
    await ensure_provider_governance_catalog(session)
    item = await session.scalar(
        select(PlatformBankProvider)
        .where(PlatformBankProvider.code == normalized)
        .with_for_update()
    )
    if item is None:
        raise APIError("BANKING_PROVIDER_UNKNOWN", "Provider bancário não existe no catálogo.", 404)
    before = governance_dict(item, manifest=banking_providers.manifest(normalized))

    if not item.driver_installed and (
        payload.globally_enabled is True or payload.tenant_visible is True
    ):
        raise APIError(
            "BANKING_PROVIDER_NOT_AVAILABLE",
            "Provider sem executor real não pode ser habilitado nem exposto aos tenants.",
            409,
            {"provider": normalized, "driver_status": item.driver_status},
        )
    if payload.globally_enabled is not None:
        item.globally_enabled = payload.globally_enabled
    if payload.tenant_visible is not None:
        item.tenant_visible = payload.tenant_visible
    if payload.notes is not None:
        item.notes = payload.notes.strip() or None

    await session.flush()
    after = governance_dict(item, manifest=banking_providers.manifest(normalized))
    await platform_audit(
        session,
        action="bank.provider.governance.updated",
        entity_type="PlatformBankProvider",
        entity_id=str(item.id),
        actor_id=user.id,
        before={
            "globally_enabled": before["globally_enabled"],
            "tenant_visible": before["tenant_visible"],
            "notes": before["notes"],
        },
        after={
            "globally_enabled": item.globally_enabled,
            "tenant_visible": item.tenant_visible,
            "notes": item.notes,
        },
        context={"provider": normalized},
    )
    await session.commit()
    return SuccessResponse(data=after)


@router.get("/plans/{plan_code}/providers", response_model=SuccessResponse[dict])
async def get_plan_provider_policy(
    plan_code: str,
    session: AsyncSession = Depends(get_platform_session),
    _: AuthUser = Depends(
        require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")
    ),
) -> SuccessResponse[dict]:
    plan = await session.scalar(select(PlatformPlan).where(PlatformPlan.code == plan_code.strip().upper()))
    if plan is None:
        raise APIError("PLAN_NOT_FOUND", "Plano não encontrado.", 404)
    await ensure_provider_governance_catalog(session)
    await session.commit()
    return SuccessResponse(data=await read_plan_policy(session, plan=plan))


@router.put("/plans/{plan_code}/providers", response_model=SuccessResponse[dict])
async def put_plan_provider_policy(
    plan_code: str,
    payload: PlanBankProviderPolicyInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    plan = await session.scalar(select(PlatformPlan).where(PlatformPlan.code == plan_code.strip().upper()))
    if plan is None:
        raise APIError("PLAN_NOT_FOUND", "Plano não encontrado.", 404)
    before = await read_plan_policy(session, plan=plan)
    await replace_plan_policy(
        session,
        plan=plan,
        mode=payload.mode,
        providers=payload.providers,
    )
    after = await read_plan_policy(session, plan=plan)
    await platform_audit(
        session,
        action="bank.plan_provider_policy.updated",
        entity_type="PlatformPlan",
        entity_id=str(plan.id),
        actor_id=user.id,
        before=before,
        after=after,
        context={"plan_code": plan.code},
    )
    await session.commit()
    return SuccessResponse(data=after)


@router.get("/tenants/{tenant_id}/providers", response_model=SuccessResponse[dict])
async def get_tenant_provider_policy(
    tenant_id: UUID,
    session: AsyncSession = Depends(get_platform_session),
    _: AuthUser = Depends(
        require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN", "PLATFORM_SUPPORT", "PLATFORM_AUDITOR")
    ),
) -> SuccessResponse[dict]:
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)
    await ensure_provider_governance_catalog(session)
    policy = await read_tenant_policy(session, tenant=tenant)
    decisions = await tenant_provider_decisions(session, tenant_id=tenant.id)
    await session.commit()
    return SuccessResponse(
        data={
            **policy,
            "tenant_name": tenant.name,
            "tenant_slug": tenant.slug,
            "plan_code": tenant.plan_code,
            "providers": [decision.public_dict() for decision in decisions],
        }
    )


@router.put("/tenants/{tenant_id}/providers", response_model=SuccessResponse[dict])
async def put_tenant_provider_policy(
    tenant_id: UUID,
    payload: TenantBankProviderPolicyInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise APIError("TENANT_NOT_FOUND", "Tenant não encontrado.", 404)
    before = await read_tenant_policy(session, tenant=tenant)
    await replace_tenant_policy(
        session,
        tenant=tenant,
        mode=payload.mode,
        overrides=[(item.provider, item.action) for item in payload.overrides],
    )
    after = await read_tenant_policy(session, tenant=tenant)
    decisions = await tenant_provider_decisions(session, tenant_id=tenant.id)
    await platform_audit(
        session,
        action="bank.tenant_provider_policy.updated",
        entity_type="Tenant",
        entity_id=str(tenant.id),
        tenant_id=tenant.id,
        actor_id=user.id,
        before=before,
        after=after,
        context={"tenant_slug": tenant.slug, "plan_code": tenant.plan_code},
    )
    await session.commit()
    return SuccessResponse(
        data={
            **after,
            "tenant_name": tenant.name,
            "tenant_slug": tenant.slug,
            "plan_code": tenant.plan_code,
            "providers": [decision.public_dict() for decision in decisions],
        }
    )


@router.get("/institutions", response_model=SuccessResponse[list[dict]])
async def control_bank_institutions(
    q: str | None = Query(default=None, max_length=120),
    session: AsyncSession = Depends(get_platform_session),
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
) -> SuccessResponse[list[dict]]:
    service = BankInstitutionCatalogService(session)
    await service.ensure_manifest_seeds()
    await session.commit()
    stmt = select(BankInstitution)
    if q:
        term = f"%{q.strip()}%"
        stmt = stmt.where(
            BankInstitution.short_name.ilike(term)
            | BankInstitution.legal_name.ilike(term)
            | BankInstitution.bank_code.ilike(term)
            | BankInstitution.ispb.ilike(term)
        )
    items = list((await session.scalars(stmt.order_by(BankInstitution.short_name).limit(5000))).all())
    return SuccessResponse(data=[institution_dict(item) for item in items])


@router.post("/institutions/sync", response_model=SuccessResponse[dict])
async def sync_bank_institutions(
    payload: BankInstitutionSyncRequest,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await BankInstitutionCatalogService(session).sync_from_bcb(resource_url=payload.resource_url)
    await platform_audit(
        session,
        action="bank.institutions.synced",
        entity_type="BankInstitutionCatalog",
        entity_id="BCB",
        actor_id=user.id,
        after=result,
        context={"source": "Banco Central do Brasil"},
    )
    await session.commit()
    return SuccessResponse(data=result)
