from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ensure_company_access, get_tenant_db, require_permission
from app.core.errors import APIError
from app.models.security import TenantMFAState
from app.models.tenant import Company, TenantUser, UserCompany
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import tenant_audit
from app.services.mfa import TenantMFAService

router = APIRouter(prefix="/api/v1/security", tags=["Segurança"])


class CompanySecurityInput(BaseModel):
    require_2fa: bool = True


def company_stmt(user: AuthUser):
    stmt = select(Company).where(Company.is_active.is_(True)).order_by(Company.legal_name)
    if user.role != "TENANT_ADMIN" and "*" not in user.permissions:
        stmt = stmt.where(Company.id.in_([UUID(value) for value in user.companies]))
    return stmt


@router.get("/company-profiles", response_model=SuccessResponse[list[dict]])
async def company_profiles(
    user: AuthUser = Depends(require_permission("companies.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    companies = list((await session.scalars(company_stmt(user))).all())
    return SuccessResponse(data=[
        {
            "company_id": str(company.id),
            "state_registration": company.state_registration,
            "municipal_registration": company.municipal_registration,
            "tax_regime": company.tax_regime,
            "settings": company.settings or {},
            "require_2fa": bool((company.settings or {}).get("security", {}).get("require_2fa", True)),
        }
        for company in companies
    ])


@router.get("/company-policies", response_model=SuccessResponse[list[dict]])
async def company_policies(
    user: AuthUser = Depends(require_permission("companies.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    companies = list((await session.scalars(company_stmt(user))).all())
    return SuccessResponse(data=[
        {
            "company_id": str(company.id),
            "require_2fa": bool((company.settings or {}).get("security", {}).get("require_2fa", True)),
        }
        for company in companies
    ])


@router.put("/company-policies/{company_id}", response_model=SuccessResponse[dict])
async def update_company_policy(
    company_id: UUID,
    payload: CompanySecurityInput,
    user: AuthUser = Depends(require_permission("companies.update")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    ensure_company_access(user, company_id)
    company = await session.get(Company, company_id)
    if company is None:
        raise APIError("COMPANY_NOT_FOUND", "Empresa não encontrada.", 404)
    settings = dict(company.settings or {})
    security = dict(settings.get("security") or {})
    before = bool(security.get("require_2fa", True))
    security["require_2fa"] = payload.require_2fa
    settings["security"] = security
    company.settings = settings
    await tenant_audit(
        session,
        action="company.security.updated",
        entity_type="Company",
        entity_id=str(company.id),
        actor_id=user.id,
        company_id=str(company.id),
        before={"require_2fa": before},
        after={"require_2fa": payload.require_2fa},
    )
    await session.commit()
    return SuccessResponse(data={"company_id": str(company.id), "require_2fa": payload.require_2fa})


@router.get("/users/mfa-status", response_model=SuccessResponse[list[dict]])
async def users_mfa_status(
    _: AuthUser = Depends(require_permission("users.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    users = list((await session.scalars(select(TenantUser).order_by(TenantUser.name))).all())
    states = {
        item.user_id: item
        for item in (await session.scalars(select(TenantMFAState))).all()
    }
    output = []
    for user in users:
        state = states.get(user.id)
        output.append({
            "user_id": str(user.id),
            "enabled": bool(state and state.totp_enabled),
            "confirmed_at": state.confirmed_at.isoformat() if state and state.confirmed_at else None,
            "last_verified_at": state.last_verified_at.isoformat() if state and state.last_verified_at else None,
            "required": await TenantMFAService.policy_required(session, user),
        })
    return SuccessResponse(data=output)


@router.post("/users/{user_id}/reset-mfa", response_model=SuccessResponse[dict])
async def reset_user_mfa(
    user_id: UUID,
    actor: AuthUser = Depends(require_permission("users.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    user = await session.get(TenantUser, user_id)
    if user is None:
        raise APIError("USER_NOT_FOUND", "Usuário não encontrado.", 404)
    await TenantMFAService.reset(session, user)
    await tenant_audit(
        session,
        action="user.mfa_reset",
        entity_type="TenantUser",
        entity_id=str(user.id),
        actor_id=actor.id,
    )
    await session.commit()
    return SuccessResponse(data={"user_id": str(user.id), "mfa_reset": True})
