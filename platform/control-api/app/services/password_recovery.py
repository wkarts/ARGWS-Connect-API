from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import structlog
from fastapi import Request
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import APIError
from app.core.rate_limit import RateLimit, consume_rate_limit, request_identity
from app.core.security import hash_password
from app.models.platform import PlatformRefreshToken, PlatformUser
from app.models.platform_security import PlatformPasswordResetToken
from app.services.audit import platform_audit

logger = structlog.get_logger(__name__)

GENERIC_REQUEST_MESSAGE = (
    "Se o e-mail estiver cadastrado e ativo, enviaremos as instruções para redefinir a senha."
)


@dataclass(frozen=True, slots=True)
class PasswordResetDelivery:
    user_id: UUID
    name: str
    email: str
    token: str


@dataclass(frozen=True, slots=True)
class PasswordResetConfirmation:
    user_id: UUID
    name: str
    email: str


def generate_password_reset_token() -> str:
    return secrets.token_urlsafe(48)


def hash_password_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _consume_limit(*, key: str, limit: int) -> tuple[bool, int]:
    from app.api.deps import get_redis

    redis = await get_redis()
    rule = RateLimit(limit=limit, window_seconds=3600)
    allowed, _, retry_after = await consume_rate_limit(redis, key=key, rule=rule)
    return allowed, retry_after


async def enforce_password_reset_request_limit(request: Request, email: str) -> None:
    """Limita por origem e por conta sem persistir o endereço no Redis."""

    window = int(time.time()) // 3600
    identity = hashlib.sha256(request_identity(request).encode("utf-8")).hexdigest()
    account = hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
    rules = (
        (
            f"rate-limit:password-reset-request:ip:{identity}:{window}",
            settings.password_reset_requests_per_ip_hour,
        ),
        (
            f"rate-limit:password-reset-request:account:{account}:{window}",
            settings.password_reset_requests_per_account_hour,
        ),
    )
    try:
        for key, limit in rules:
            allowed, retry_after = await _consume_limit(key=key, limit=limit)
            if not allowed:
                raise APIError(
                    "PASSWORD_RESET_RATE_LIMITED",
                    "Muitas solicitações de recuperação. Tente novamente mais tarde.",
                    429,
                    {"retry_after": retry_after},
                )
    except APIError:
        raise
    except Exception as exc:
        logger.warning("password_reset_rate_limit_unavailable", error=type(exc).__name__)


async def enforce_password_reset_attempt_limit(request: Request) -> None:
    window = int(time.time()) // 3600
    identity = hashlib.sha256(request_identity(request).encode("utf-8")).hexdigest()
    try:
        allowed, retry_after = await _consume_limit(
            key=f"rate-limit:password-reset-attempt:ip:{identity}:{window}",
            limit=settings.password_reset_attempts_per_ip_hour,
        )
        if not allowed:
            raise APIError(
                "PASSWORD_RESET_RATE_LIMITED",
                "Muitas tentativas de redefinição. Tente novamente mais tarde.",
                429,
                {"retry_after": retry_after},
            )
    except APIError:
        raise
    except Exception as exc:
        logger.warning("password_reset_attempt_limit_unavailable", error=type(exc).__name__)


class PasswordRecoveryService:
    async def request_control_reset(
        self,
        session: AsyncSession,
        *,
        email: str,
    ) -> PasswordResetDelivery | None:
        normalized = email.strip().lower()
        result = await session.execute(
            select(PlatformUser).where(
                func.lower(PlatformUser.email) == normalized,
                PlatformUser.is_active.is_(True),
            )
        )
        user = result.scalar_one_or_none()
        if user is None:
            return None

        now = datetime.now(UTC)
        await session.execute(
            update(PlatformPasswordResetToken)
            .where(
                PlatformPasswordResetToken.user_id == user.id,
                PlatformPasswordResetToken.used_at.is_(None),
            )
            .values(used_at=now, updated_at=now)
        )

        raw_token = generate_password_reset_token()
        session.add(
            PlatformPasswordResetToken(
                user_id=user.id,
                token_hash=hash_password_reset_token(raw_token),
                expires_at=now + timedelta(minutes=settings.password_reset_token_ttl_minutes),
            )
        )
        await platform_audit(
            session,
            action="platform_user.password_reset_requested",
            entity_type="PlatformUser",
            entity_id=str(user.id),
            actor_id=None,
            after={
                "delivery": "smtp",
                "expires_in_minutes": settings.password_reset_token_ttl_minutes,
            },
            context={"origin": "control-plane-auth", "token_logged": False, "email_logged": False},
        )
        await session.commit()
        return PasswordResetDelivery(
            user_id=user.id,
            name=user.name,
            email=user.email,
            token=raw_token,
        )

    async def reset_control_password(
        self,
        session: AsyncSession,
        *,
        token: str,
        password: str,
    ) -> PasswordResetConfirmation:
        now = datetime.now(UTC)
        token_hash = hash_password_reset_token(token)
        result = await session.execute(
            select(PlatformPasswordResetToken)
            .where(
                PlatformPasswordResetToken.token_hash == token_hash,
                PlatformPasswordResetToken.used_at.is_(None),
                PlatformPasswordResetToken.expires_at > now,
            )
            .with_for_update()
        )
        reset_token = result.scalar_one_or_none()
        if reset_token is None:
            raise APIError(
                "PASSWORD_RESET_TOKEN_INVALID",
                "O link de recuperação é inválido, já foi utilizado ou expirou.",
                400,
            )

        user_result = await session.execute(
            select(PlatformUser).where(PlatformUser.id == reset_token.user_id).with_for_update()
        )
        user = user_result.scalar_one_or_none()
        if user is None or not user.is_active:
            raise APIError(
                "PASSWORD_RESET_TOKEN_INVALID",
                "O link de recuperação é inválido, já foi utilizado ou expirou.",
                400,
            )

        user.password_hash = hash_password(password)
        user.failed_login_attempts = 0
        user.locked_until = None

        await session.execute(
            update(PlatformPasswordResetToken)
            .where(
                PlatformPasswordResetToken.user_id == user.id,
                PlatformPasswordResetToken.used_at.is_(None),
            )
            .values(used_at=now, updated_at=now)
        )
        await session.execute(
            update(PlatformRefreshToken)
            .where(
                PlatformRefreshToken.user_id == user.id,
                PlatformRefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        await platform_audit(
            session,
            action="platform_user.password_reset_completed",
            entity_type="PlatformUser",
            entity_id=str(user.id),
            actor_id=str(user.id),
            after={"sessions_revoked": True, "all_reset_tokens_invalidated": True},
            context={"origin": "control-plane-auth", "token_logged": False, "password_logged": False},
        )
        await session.commit()
        return PasswordResetConfirmation(user_id=user.id, name=user.name, email=user.email)
