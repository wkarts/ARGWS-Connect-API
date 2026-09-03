from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import APIError
from app.core.security import create_token, decode_token, hash_api_key, verify_password
from app.models.platform import PlatformRefreshToken, PlatformUser
from app.models.tenant import TenantRefreshToken, TenantUser, UserCompany
from app.schemas.auth import AuthUser, TokenPair
from app.services.mfa import PlatformMFAService, TenantMFAService


class AuthService:
    @staticmethod
    def _token_pair(
        *,
        user_id: str,
        audience: str,
        role: str,
        tenant_id: str | None = None,
        permissions: list[str] | None = None,
        mfa_verified: bool | None = None,
    ) -> TokenPair:
        extra = {"permissions": permissions or []}
        refresh_extra: dict[str, object] = {}
        if audience in {"tenant", "control"}:
            verified = bool(mfa_verified)
            extra["mfa_verified"] = verified
            refresh_extra["mfa_verified"] = verified
        access = create_token(
            subject=user_id,
            audience=audience,  # type: ignore[arg-type]
            token_type="access",
            tenant_id=tenant_id,
            roles=[role],
            extra=extra,
        )
        refresh = create_token(
            subject=user_id,
            audience=audience,  # type: ignore[arg-type]
            token_type="refresh",
            tenant_id=tenant_id,
            roles=[role],
            extra=refresh_extra or None,
        )
        return TokenPair(
            access_token=access,
            refresh_token=refresh,
            expires_in=settings.access_token_minutes * 60,
        )

    @staticmethod
    async def _company_ids(session: AsyncSession, user_id: UUID) -> list[str]:
        return [
            str(item)
            for item in (
                await session.scalars(select(UserCompany.company_id).where(UserCompany.user_id == user_id))
            ).all()
        ]

    async def _persist_control_pair(
        self,
        session: AsyncSession,
        *,
        user: PlatformUser,
        mfa_verified: bool,
    ) -> TokenPair:
        pair = self._token_pair(
            user_id=str(user.id),
            audience="control",
            role=user.role,
            mfa_verified=mfa_verified,
        )
        session.add(
            PlatformRefreshToken(
                user_id=user.id,
                token_hash=hash_api_key(pair.refresh_token),
                expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
            )
        )
        await session.commit()
        return pair

    async def _persist_tenant_pair(
        self,
        session: AsyncSession,
        *,
        user: TenantUser,
        tenant_id: str,
        mfa_verified: bool,
    ) -> TokenPair:
        pair = self._token_pair(
            user_id=str(user.id),
            audience="tenant",
            role=user.role,
            tenant_id=tenant_id,
            permissions=user.permissions,
            mfa_verified=mfa_verified,
        )
        session.add(
            TenantRefreshToken(
                user_id=user.id,
                token_hash=hash_api_key(pair.refresh_token),
                expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
            )
        )
        await session.commit()
        return pair

    async def login_control(
        self, session: AsyncSession, email: str, password: str
    ) -> tuple[TokenPair, AuthUser, dict]:
        user = await session.scalar(select(PlatformUser).where(PlatformUser.email == email.lower()))
        if user is None or not user.is_active:
            raise APIError("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401)
        now = datetime.now(UTC)
        if user.locked_until and user.locked_until > now:
            raise APIError("ACCOUNT_LOCKED", "Conta temporariamente bloqueada.", 423)
        if not verify_password(password, user.password_hash):
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= settings.login_max_attempts:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
            await session.commit()
            raise APIError("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401)
        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = now
        security = await PlatformMFAService.status(session, user, token_verified=False)
        pair = await self._persist_control_pair(session, user=user, mfa_verified=False)
        auth_user = AuthUser(id=str(user.id), name=user.name, email=user.email, role=user.role)
        return pair, auth_user, security

    async def issue_verified_control_pair(
        self, session: AsyncSession, *, user: PlatformUser
    ) -> tuple[TokenPair, AuthUser, dict]:
        pair = await self._persist_control_pair(session, user=user, mfa_verified=True)
        security = await PlatformMFAService.status(session, user, token_verified=True)
        return pair, AuthUser(id=str(user.id), name=user.name, email=user.email, role=user.role), security

    async def login_tenant(
        self, session: AsyncSession, tenant_id: str, email: str, password: str
    ) -> tuple[TokenPair, AuthUser, dict]:
        user = await session.scalar(select(TenantUser).where(TenantUser.email == email.lower()))
        if user is None or not user.is_active:
            raise APIError("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401)
        now = datetime.now(UTC)
        if user.locked_until and user.locked_until > now:
            raise APIError("ACCOUNT_LOCKED", "Conta temporariamente bloqueada.", 423)
        if not verify_password(password, user.password_hash):
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= settings.login_max_attempts:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
            await session.commit()
            raise APIError("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401)

        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = now
        mfa = await TenantMFAService.status(session, user, token_verified=False)
        mfa_verified = not bool(mfa["required"])
        pair = await self._persist_tenant_pair(
            session, user=user, tenant_id=tenant_id, mfa_verified=mfa_verified
        )
        company_ids = await self._company_ids(session, user.id)
        return pair, AuthUser(
            id=str(user.id),
            name=user.name,
            email=user.email,
            role=user.role,
            permissions=user.permissions,
            companies=company_ids,
        ), {**mfa, "verified": mfa_verified}

    async def issue_verified_tenant_pair(
        self, session: AsyncSession, *, tenant_id: str, user: TenantUser
    ) -> tuple[TokenPair, AuthUser, dict]:
        pair = await self._persist_tenant_pair(
            session, user=user, tenant_id=tenant_id, mfa_verified=True
        )
        company_ids = await self._company_ids(session, user.id)
        mfa = await TenantMFAService.status(session, user, token_verified=True)
        return pair, AuthUser(
            id=str(user.id),
            name=user.name,
            email=user.email,
            role=user.role,
            permissions=user.permissions,
            companies=company_ids,
        ), mfa

    async def refresh_control(self, session: AsyncSession, refresh_token: str) -> TokenPair:
        payload = decode_token(refresh_token, "control", "refresh")
        stored = await session.scalar(
            select(PlatformRefreshToken).where(
                PlatformRefreshToken.token_hash == hash_api_key(refresh_token),
                PlatformRefreshToken.revoked_at.is_(None),
                PlatformRefreshToken.expires_at > datetime.now(UTC),
            )
        )
        if stored is None:
            raise APIError("REFRESH_TOKEN_REVOKED", "Refresh token inválido ou revogado.", 401)
        user = await session.get(PlatformUser, UUID(payload["sub"]))
        if user is None or not user.is_active:
            raise APIError("USER_NOT_ACTIVE", "Usuário não está ativo.", 401)
        stored.revoked_at = datetime.now(UTC)
        pair = self._token_pair(
            user_id=str(user.id),
            audience="control",
            role=user.role,
            mfa_verified=bool(payload.get("mfa_verified")),
        )
        session.add(
            PlatformRefreshToken(
                user_id=user.id,
                token_hash=hash_api_key(pair.refresh_token),
                expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
            )
        )
        await session.commit()
        return pair

    async def refresh_tenant(self, session: AsyncSession, tenant_id: str, refresh_token: str) -> TokenPair:
        payload = decode_token(refresh_token, "tenant", "refresh")
        if payload.get("tenant_id") != tenant_id:
            raise APIError("TENANT_TOKEN_MISMATCH", "Token não pertence a este ambiente.", 403)
        stored = await session.scalar(
            select(TenantRefreshToken).where(
                TenantRefreshToken.token_hash == hash_api_key(refresh_token),
                TenantRefreshToken.revoked_at.is_(None),
                TenantRefreshToken.expires_at > datetime.now(UTC),
            )
        )
        if stored is None:
            raise APIError("REFRESH_TOKEN_REVOKED", "Refresh token inválido ou revogado.", 401)
        user = await session.get(TenantUser, UUID(payload["sub"]))
        if user is None or not user.is_active:
            raise APIError("USER_NOT_ACTIVE", "Usuário não está ativo.", 401)
        stored.revoked_at = datetime.now(UTC)

        policy_required = await TenantMFAService.policy_required(session, user)
        mfa_verified = bool(payload.get("mfa_verified")) or not policy_required
        pair = self._token_pair(
            user_id=str(user.id),
            audience="tenant",
            role=user.role,
            tenant_id=tenant_id,
            permissions=user.permissions,
            mfa_verified=mfa_verified,
        )
        session.add(
            TenantRefreshToken(
                user_id=user.id,
                token_hash=hash_api_key(pair.refresh_token),
                expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
            )
        )
        await session.commit()
        return pair

    async def logout_control(self, session: AsyncSession, user_id: str, refresh_token: str) -> None:
        stored = await session.scalar(
            select(PlatformRefreshToken).where(
                PlatformRefreshToken.user_id == UUID(user_id),
                PlatformRefreshToken.token_hash == hash_api_key(refresh_token),
                PlatformRefreshToken.revoked_at.is_(None),
            )
        )
        if stored is not None:
            stored.revoked_at = datetime.now(UTC)
            await session.commit()

    async def logout_tenant(self, session: AsyncSession, user_id: str, refresh_token: str) -> None:
        stored = await session.scalar(
            select(TenantRefreshToken).where(
                TenantRefreshToken.user_id == UUID(user_id),
                TenantRefreshToken.token_hash == hash_api_key(refresh_token),
                TenantRefreshToken.revoked_at.is_(None),
            )
        )
        if stored is not None:
            stored.revoked_at = datetime.now(UTC)
            await session.commit()
