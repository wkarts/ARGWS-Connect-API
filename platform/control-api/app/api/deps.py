from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import accessible_company_ids, ensure_company_access
from app.core.config import settings
from app.core.errors import APIError
from app.core.security import decode_token, hash_api_key
from app.core.tenant_context import TenantContext, reset_tenant_context, set_tenant_context
from app.db.platform import get_platform_session
from app.db.tenant import tenant_session
from app.models.platform import PlatformApiKey, PlatformUser, SupportSession
from app.models.tenant import TenantApiKey, TenantUser, UserCompany
from app.schemas.auth import AuthUser
from app.services.entitlements import TenantEntitlements, load_tenant_entitlements
from app.services.mfa import PlatformMFAService, TenantMFAService
from app.services.tenant_resolver import TenantResolver

bearer = HTTPBearer(auto_error=False)
_redis: Redis | None = None


async def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None


def request_hostname(request: Request) -> str:
    host = request.headers.get("host", "")
    if settings.app_env in {"development", "testing"} and settings.allow_dev_tenant_header:
        host = request.headers.get("x-tenant-host", host)
    return TenantResolver.normalize_hostname(host)


async def ensure_control_plane_host(request: Request) -> None:
    if settings.app_env in {"development", "testing"}:
        return
    host = request_hostname(request)
    if host != settings.control_plane_host.lower():
        raise APIError("CONTROL_PLANE_HOST_REQUIRED", "Endpoint exclusivo do Control Plane.", 404)


async def get_tenant_context_dep(
    request: Request,
    platform_session: AsyncSession = Depends(get_platform_session),
    redis: Redis = Depends(get_redis),
) -> AsyncIterator[TenantContext]:
    host = request_hostname(request)
    if host == settings.control_plane_host.lower():
        raise APIError("TENANT_HOST_REQUIRED", "Este endpoint exige domínio de tenant.", 404)
    resolver = TenantResolver(platform_session, redis)
    context = await resolver.resolve(host)
    token = set_tenant_context(context)
    request.state.tenant = context
    try:
        yield context
    finally:
        reset_tenant_context(token)


async def get_tenant_db(
    context: TenantContext = Depends(get_tenant_context_dep),
) -> AsyncIterator[AsyncSession]:
    async for session in tenant_session(context):
        yield session


async def get_tenant_entitlements(
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_platform_session),
) -> TenantEntitlements:
    return await load_tenant_entitlements(session, context.tenant_id)


def token_or_error(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise APIError("AUTHENTICATION_REQUIRED", "Autenticação obrigatória.", 401)
    return credentials.credentials


async def current_control_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    x_platform_api_key: str = Header(default="", alias="X-Platform-API-Key"),
    session: AsyncSession = Depends(get_platform_session),
) -> AuthUser:
    await ensure_control_plane_host(request)
    if x_platform_api_key:
        api_key = await session.scalar(
            select(PlatformApiKey).where(PlatformApiKey.key_hash == hash_api_key(x_platform_api_key))
        )
        now = datetime.now(UTC)
        if (
            api_key is None
            or not api_key.is_active
            or (api_key.expires_at is not None and api_key.expires_at <= now)
        ):
            raise APIError("INVALID_PLATFORM_API_KEY", "Chave da plataforma inválida, revogada ou expirada.", 401)
        forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
        client_ip = forwarded or (request.client.host if request.client else "")
        if api_key.allowed_ips and client_ip not in api_key.allowed_ips:
            raise APIError("PLATFORM_API_KEY_IP_DENIED", "Endereço IP não autorizado para esta chave.", 403)
        api_key.last_used_at = now
        await session.commit()
        return AuthUser(
            id=str(api_key.id),
            name=f"API Plataforma: {api_key.name}",
            email=f"{api_key.key_prefix}@connect-api.local",
            role="PLATFORM_API_KEY",
            permissions=api_key.permissions,
            companies=[],
        )

    payload = decode_token(token_or_error(credentials), "control")
    user = await session.get(PlatformUser, UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise APIError("USER_NOT_ACTIVE", "Usuário do Control Plane não está ativo.", 401)

    mfa_verified = bool(payload.get("mfa_verified"))
    mfa_exempt = request.url.path.startswith("/api/control/v1/auth/mfa/") or request.url.path == "/api/control/v1/auth/logout"
    if not mfa_verified and not mfa_exempt:
        state = await PlatformMFAService.state(session, user.id)
        raise APIError(
            "MFA_REQUIRED",
            "O Control Plane exige autenticação em duas etapas para continuar.",
            428,
            {"mode": "VERIFY" if state and state.totp_enabled else "SETUP"},
        )

    return AuthUser(id=str(user.id), name=user.name, email=user.email, role=user.role)


async def current_connect_api_tser(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    x_api_key: str = Header(default="", alias="X-API-Key"),
    context: TenantContext = Depends(get_tenant_context_dep),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> AuthUser:
    if x_api_key:
        api_key = await session.scalar(
            select(TenantApiKey).where(TenantApiKey.key_hash == hash_api_key(x_api_key))
        )
        now = datetime.now(UTC)
        if (
            api_key is None
            or not api_key.is_active
            or api_key.revoked_at is not None
            or (api_key.expires_at is not None and api_key.expires_at <= now)
        ):
            raise APIError("INVALID_API_KEY", "Chave de API inválida, revogada ou expirada.", 401)
        forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
        client_ip = forwarded or (request.client.host if request.client else "")
        if api_key.allowed_ips and client_ip not in api_key.allowed_ips:
            raise APIError("API_KEY_IP_DENIED", "Endereço IP não autorizado para esta chave.", 403)
        api_key.last_used_at = now
        await session.flush()
        return AuthUser(
            id=str(api_key.id),
            name=f"API: {api_key.name}",
            email=f"{api_key.key_prefix}@api.local",
            role="API_KEY",
            permissions=api_key.permissions,
            companies=api_key.company_ids,
        )

    payload = decode_token(token_or_error(credentials), "tenant")
    if payload.get("tenant_id") != context.tenant_id:
        raise APIError("TENANT_TOKEN_MISMATCH", "Token não pertence ao domínio acessado.", 403)

    support_session_id = payload.get("support_session_id")
    if support_session_id:
        support = await platform_session.get(SupportSession, UUID(str(support_session_id)))
        if (
            support is None
            or str(support.tenant_id) != context.tenant_id
            or support.status != "ACTIVE"
            or support.revoked_at is not None
            or support.expires_at <= datetime.now(UTC)
        ):
            raise APIError("SUPPORT_SESSION_INVALID", "Sessão de suporte inválida ou expirada.", 401)
        platform_user = await platform_session.get(PlatformUser, support.platform_user_id)
        if platform_user is None or not platform_user.is_active:
            raise APIError("SUPPORT_USER_NOT_ACTIVE", "Operador de suporte não está ativo.", 401)
        return AuthUser(
            id=str(platform_user.id),
            name=f"{platform_user.name} (Suporte)",
            email=platform_user.email,
            role="SUPPORT_IMPERSONATION",
            permissions=["*"],
            companies=[],
        )

    user = await session.get(TenantUser, UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise APIError("USER_NOT_ACTIVE", "Usuário não está ativo.", 401)

    mfa_required = await TenantMFAService.policy_required(session, user)
    mfa_verified = bool(payload.get("mfa_verified"))
    mfa_exempt = request.url.path.startswith("/api/v1/auth/mfa/") or request.url.path == "/api/v1/auth/logout"
    if mfa_required and not mfa_verified and not mfa_exempt:
        state = await TenantMFAService.state(session, user.id)
        raise APIError(
            "MFA_REQUIRED",
            "Confirme a autenticação em duas etapas para continuar.",
            428,
            {"mode": "VERIFY" if state and state.totp_enabled else "SETUP"},
        )

    company_ids = [
        str(company_id)
        for company_id in (
            await session.scalars(select(UserCompany.company_id).where(UserCompany.user_id == user.id))
        ).all()
    ]
    return AuthUser(
        id=str(user.id),
        name=user.name,
        email=user.email,
        role=user.role,
        permissions=user.permissions,
        companies=company_ids,
    )


def require_control_roles(*roles: str) -> Callable[..., AuthUser]:
    async def dependency(user: AuthUser = Depends(current_control_user)) -> AuthUser:
        if user.role == "PLATFORM_SUPERADMIN" or user.role in roles:
            return user
        if user.role == "PLATFORM_API_KEY":
            permissions = set(user.permissions)
            required = {"control.read"}
            if "PLATFORM_ADMIN" in roles:
                required.add("control.manage")
            if "PLATFORM_SUPERADMIN" in roles:
                required.add("control.superadmin")
            if "*" in permissions or permissions.intersection(required):
                return user
        raise APIError("FORBIDDEN", "Permissão insuficiente no Control Plane.", 403)
    return dependency


def require_permission(permission: str) -> Callable[..., AuthUser]:
    async def dependency(user: AuthUser = Depends(current_connect_api_tser)) -> AuthUser:
        if user.role == "TENANT_ADMIN" or "*" in user.permissions or permission in user.permissions:
            return user
        raise APIError("FORBIDDEN", "Permissão insuficiente.", 403, {"required": permission})
    return dependency
