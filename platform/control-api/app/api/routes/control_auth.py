from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_control_user, ensure_control_plane_host
from app.core.errors import APIError
from app.db.platform import get_platform_session
from app.models.platform import PlatformUser
from app.schemas.auth import AuthUser, LoginRequest, RefreshRequest, TokenPair
from app.schemas.common import SuccessResponse
from app.services.audit import platform_audit
from app.services.auth import AuthService
from app.services.mfa import PlatformMFAService

router = APIRouter(prefix="/api/control/v1/auth", tags=["Control Plane - Auth"])
service = AuthService()


class MFACodeInput(BaseModel):
    code: str = Field(min_length=6, max_length=16)


def session_payload(tokens: TokenPair, user: AuthUser, security: dict) -> dict:
    return {
        "tokens": tokens.model_dump(),
        "user": user.model_dump(),
        "security": security,
    }


async def db_user(session: AsyncSession, auth_user: AuthUser) -> PlatformUser:
    user = await session.get(PlatformUser, UUID(auth_user.id))
    if user is None or not user.is_active:
        raise APIError("USER_NOT_ACTIVE", "Usuário do Control Plane não está ativo.", 401)
    return user


@router.post("/login", response_model=SuccessResponse[dict])
async def login(
    request: Request,
    payload: LoginRequest,
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    await ensure_control_plane_host(request)
    tokens, user, security = await service.login_control(session, payload.email, payload.password)
    return SuccessResponse(data=session_payload(tokens, user, security))


@router.post("/refresh", response_model=SuccessResponse[TokenPair])
async def refresh(
    request: Request,
    payload: RefreshRequest,
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[TokenPair]:
    await ensure_control_plane_host(request)
    return SuccessResponse(data=await service.refresh_control(session, payload.refresh_token))


@router.get("/mfa/status", response_model=SuccessResponse[dict])
async def mfa_status(
    user: AuthUser = Depends(current_control_user),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    current = await db_user(session, user)
    return SuccessResponse(data=await PlatformMFAService.status(session, current, token_verified=False))


@router.post("/mfa/setup", response_model=SuccessResponse[dict])
async def mfa_setup(
    user: AuthUser = Depends(current_control_user),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    current = await db_user(session, user)
    setup = await PlatformMFAService.begin_setup(session, current, "Connect|API Control Plane")
    await platform_audit(
        session,
        action="platform_user.mfa_setup_started",
        entity_type="PlatformUser",
        entity_id=str(current.id),
        actor_id=str(current.id),
        after={"method": "TOTP", "required": True},
        context={"origin": "control-plane-auth", "secret_logged": False},
    )
    await session.commit()
    return SuccessResponse(data=setup)


@router.post("/mfa/confirm", response_model=SuccessResponse[dict])
async def mfa_confirm(
    payload: MFACodeInput,
    user: AuthUser = Depends(current_control_user),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    current = await db_user(session, user)
    await PlatformMFAService.verify(session, current, payload.code, enable=True)
    tokens, auth_user, security = await service.issue_verified_control_pair(session, user=current)
    await platform_audit(
        session,
        action="platform_user.mfa_enabled",
        entity_type="PlatformUser",
        entity_id=str(current.id),
        actor_id=str(current.id),
        after={"method": "TOTP", "enabled": True, "verified": True},
        context={"origin": "control-plane-auth", "totp_code_logged": False},
    )
    await session.commit()
    return SuccessResponse(data=session_payload(tokens, auth_user, security))


@router.post("/mfa/verify", response_model=SuccessResponse[dict])
async def mfa_verify(
    payload: MFACodeInput,
    user: AuthUser = Depends(current_control_user),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    current = await db_user(session, user)
    await PlatformMFAService.verify(session, current, payload.code, enable=False)
    tokens, auth_user, security = await service.issue_verified_control_pair(session, user=current)
    await platform_audit(
        session,
        action="platform_user.mfa_verified",
        entity_type="PlatformUser",
        entity_id=str(current.id),
        actor_id=str(current.id),
        after={"method": "TOTP", "verified": True},
        context={"origin": "control-plane-auth", "totp_code_logged": False},
    )
    await session.commit()
    return SuccessResponse(data=session_payload(tokens, auth_user, security))


@router.get("/me", response_model=SuccessResponse[AuthUser])
async def me(user: AuthUser = Depends(current_control_user)) -> SuccessResponse[AuthUser]:
    return SuccessResponse(data=user)


@router.post("/logout", response_model=SuccessResponse[dict])
async def logout(
    payload: RefreshRequest,
    user: AuthUser = Depends(current_control_user),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    await service.logout_control(session, user.id, payload.refresh_token)
    return SuccessResponse(data={"revoked": True})
