from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_connect_api_tser, get_tenant_context_dep, get_tenant_db
from app.core.tenant_context import TenantContext
from app.models.tenant import TenantUser
from app.schemas.auth import AuthUser, LoginRequest, RefreshRequest, TokenPair
from app.schemas.common import SuccessResponse
from app.services.auth import AuthService
from app.services.mfa import TenantMFAService

router = APIRouter(prefix="/api/v1/auth", tags=["Tenant - Auth"])
service = AuthService()


class MFACodeInput(BaseModel):
    code: str = Field(min_length=6, max_length=16)


def session_payload(tokens: TokenPair, user: AuthUser, context: TenantContext, security: dict) -> dict:
    return {
        "tokens": tokens.model_dump(),
        "user": user.model_dump(),
        "tenant": {
            "id": context.tenant_id,
            "slug": context.slug,
            "hostname": context.hostname,
            "timezone": context.timezone,
        },
        "security": security,
    }


async def db_user(session: AsyncSession, auth_user: AuthUser) -> TenantUser:
    user = await session.get(TenantUser, UUID(auth_user.id))
    if user is None or not user.is_active:
        from app.core.errors import APIError
        raise APIError("USER_NOT_ACTIVE", "Usuário não está ativo.", 401)
    return user


@router.post("/login", response_model=SuccessResponse[dict])
async def login(
    payload: LoginRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    tokens, user, security = await service.login_tenant(
        session, context.tenant_id, payload.email, payload.password
    )
    return SuccessResponse(data=session_payload(tokens, user, context, security))


@router.post("/refresh", response_model=SuccessResponse[TokenPair])
async def refresh(
    payload: RefreshRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[TokenPair]:
    return SuccessResponse(data=await service.refresh_tenant(session, context.tenant_id, payload.refresh_token))


@router.get("/mfa/status", response_model=SuccessResponse[dict])
async def mfa_status(
    user: AuthUser = Depends(current_connect_api_tser),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    current = await db_user(session, user)
    return SuccessResponse(data=await TenantMFAService.status(session, current, token_verified=False))


@router.post("/mfa/setup", response_model=SuccessResponse[dict])
async def mfa_setup(
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(current_connect_api_tser),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    current = await db_user(session, user)
    setup = await TenantMFAService.begin_setup(session, current, "Connect|API Platform")
    return SuccessResponse(data=setup)


@router.post("/mfa/confirm", response_model=SuccessResponse[dict])
async def mfa_confirm(
    payload: MFACodeInput,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(current_connect_api_tser),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    current = await db_user(session, user)
    await TenantMFAService.verify(session, current, payload.code, enable=True)
    tokens, auth_user, security = await service.issue_verified_tenant_pair(
        session, tenant_id=context.tenant_id, user=current
    )
    return SuccessResponse(data=session_payload(tokens, auth_user, context, security))


@router.post("/mfa/verify", response_model=SuccessResponse[dict])
async def mfa_verify(
    payload: MFACodeInput,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(current_connect_api_tser),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    current = await db_user(session, user)
    await TenantMFAService.verify(session, current, payload.code, enable=False)
    tokens, auth_user, security = await service.issue_verified_tenant_pair(
        session, tenant_id=context.tenant_id, user=current
    )
    return SuccessResponse(data=session_payload(tokens, auth_user, context, security))


@router.get("/me", response_model=SuccessResponse[AuthUser])
async def me(user: AuthUser = Depends(current_connect_api_tser)) -> SuccessResponse[AuthUser]:
    return SuccessResponse(data=user)


@router.post("/logout", response_model=SuccessResponse[dict])
async def logout(
    payload: RefreshRequest,
    user: AuthUser = Depends(current_connect_api_tser),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    await service.logout_tenant(session, user.id, payload.refresh_token)
    return SuccessResponse(data={"revoked": True})
