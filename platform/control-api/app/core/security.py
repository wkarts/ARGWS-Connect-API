from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import settings
from app.core.errors import APIError

_password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)


def hash_password(password: str) -> str:
    if len(password) < settings.password_min_length:
        raise APIError(
            "PASSWORD_TOO_SHORT",
            f"A senha precisa ter ao menos {settings.password_min_length} caracteres.",
            422,
        )
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def create_token(
    *,
    subject: str,
    audience: Literal["control", "tenant"],
    token_type: Literal["access", "refresh"],
    tenant_id: str | None = None,
    roles: list[str] | None = None,
    expires_delta: timedelta | None = None,
    extra: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(UTC)
    if expires_delta is None:
        expires_delta = (
            timedelta(minutes=settings.access_token_minutes)
            if token_type == "access"
            else timedelta(days=settings.refresh_token_days)
        )
    payload: dict[str, Any] = {
        "sub": subject,
        "aud": audience,
        "typ": token_type,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
        "jti": secrets.token_urlsafe(24),
        "roles": roles or [],
    }
    if tenant_id:
        payload["tenant_id"] = tenant_id
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.app_secret_key, algorithm="HS256")


def decode_token(token: str, audience: Literal["control", "tenant"], token_type: str = "access") -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.app_secret_key,
            algorithms=["HS256"],
            audience=audience,
            options={"require": ["sub", "exp", "iat", "typ", "aud"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise APIError("TOKEN_EXPIRED", "Sessão expirada.", 401) from exc
    except jwt.PyJWTError as exc:
        raise APIError("INVALID_TOKEN", "Token inválido.", 401) from exc
    if payload.get("typ") != token_type:
        raise APIError("INVALID_TOKEN_TYPE", "Tipo de token inválido.", 401)
    return payload


def hash_api_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def generate_api_key() -> tuple[str, str]:
    raw = f"fin_{secrets.token_urlsafe(40)}"
    return raw, hash_api_key(raw)
