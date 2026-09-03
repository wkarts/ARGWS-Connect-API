from __future__ import annotations

import base64
from datetime import UTC, datetime
from io import BytesIO
from uuid import UUID

import pyotp
import qrcode
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.models.platform import PlatformUser
from app.models.platform_security import PlatformMFAState
from app.models.security import TenantMFAState
from app.models.tenant import Company, TenantUser, UserCompany


def _setup_payload(*, secret: str, email: str, issuer: str) -> dict:
    uri = pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)
    image = qrcode.make(uri)
    output = BytesIO()
    image.save(output, format="PNG")
    return {
        "secret": secret,
        "otpauth_uri": uri,
        "qr_data_uri": "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii"),
    }


def _normalized_code(code: str) -> str:
    normalized = "".join(character for character in str(code) if character.isdigit())
    if len(normalized) != 6:
        raise APIError("MFA_CODE_INVALID", "Informe o código de 6 dígitos do autenticador.", 422)
    return normalized


class PlatformMFAService:
    """2FA TOTP obrigatório para todo usuário humano do Control Plane."""

    @staticmethod
    async def state(session: AsyncSession, user_id: UUID) -> PlatformMFAState | None:
        return await session.scalar(
            select(PlatformMFAState).where(PlatformMFAState.user_id == user_id)
        )

    @classmethod
    async def status(cls, session: AsyncSession, user: PlatformUser, *, token_verified: bool = False) -> dict:
        state = await cls.state(session, user.id)
        enabled = bool(state and state.totp_enabled)
        return {
            "required": True,
            "enabled": enabled,
            "verified": bool(token_verified),
            "mode": "VERIFY" if enabled else "SETUP",
        }

    @classmethod
    async def begin_setup(cls, session: AsyncSession, user: PlatformUser, issuer: str) -> dict:
        state = await cls.state(session, user.id)
        if state and state.totp_enabled:
            raise APIError("MFA_ALREADY_ENABLED", "A autenticação em duas etapas já está habilitada.", 409)
        secret = pyotp.random_base32(length=32)
        if state is None:
            state = PlatformMFAState(user_id=user.id)
            session.add(state)
        state.totp_secret_encrypted = secret_cipher.encrypt(secret)
        state.totp_enabled = False
        state.confirmed_at = None
        await session.commit()
        return _setup_payload(secret=secret, email=str(user.email), issuer=issuer)

    @classmethod
    async def verify(cls, session: AsyncSession, user: PlatformUser, code: str, *, enable: bool = False) -> PlatformMFAState:
        normalized = _normalized_code(code)
        state = await cls.state(session, user.id)
        if state is None or not state.totp_secret_encrypted:
            raise APIError("MFA_SETUP_REQUIRED", "Configure primeiro a autenticação em duas etapas.", 428)
        try:
            secret = secret_cipher.decrypt(state.totp_secret_encrypted)
        except Exception as exc:
            raise APIError("MFA_SECRET_INVALID", "Não foi possível validar o autenticador configurado.", 409) from exc
        if not pyotp.TOTP(secret).verify(normalized, valid_window=1):
            raise APIError("MFA_CODE_INVALID", "Código do autenticador inválido ou expirado.", 401)
        now = datetime.now(UTC)
        state.last_verified_at = now
        if enable:
            state.totp_enabled = True
            state.confirmed_at = now
        elif not state.totp_enabled:
            raise APIError("MFA_SETUP_REQUIRED", "Confirme primeiro a configuração do autenticador.", 428)
        await session.commit()
        return state

    @classmethod
    async def reset(cls, session: AsyncSession, user: PlatformUser) -> None:
        state = await cls.state(session, user.id)
        if state is not None:
            await session.delete(state)
            await session.commit()


class TenantMFAService:
    @staticmethod
    async def policy_required(session: AsyncSession, user: TenantUser) -> bool:
        """Retorna a política efetiva de 2FA.

        O padrão é seguro: empresas sem configuração explícita exigem 2FA.
        Para usuários restritos a empresas específicas, basta uma delas exigir
        o fator adicional para que a sessão inteira o exija.
        """
        if user.role == "TENANT_ADMIN" or "*" in (user.permissions or []):
            companies = list((await session.scalars(select(Company).where(Company.is_active.is_(True)))).all())
        else:
            ids = list((await session.scalars(
                select(UserCompany.company_id).where(UserCompany.user_id == user.id)
            )).all())
            if not ids:
                return True
            companies = list((await session.scalars(
                select(Company).where(Company.id.in_(ids), Company.is_active.is_(True))
            )).all())
        if not companies:
            return True
        return any(bool((company.settings or {}).get("security", {}).get("require_2fa", True)) for company in companies)

    @staticmethod
    async def state(session: AsyncSession, user_id: UUID) -> TenantMFAState | None:
        return await session.scalar(select(TenantMFAState).where(TenantMFAState.user_id == user_id))

    @classmethod
    async def status(cls, session: AsyncSession, user: TenantUser, *, token_verified: bool = False) -> dict:
        required = await cls.policy_required(session, user)
        state = await cls.state(session, user.id)
        enabled = bool(state and state.totp_enabled)
        return {
            "required": required,
            "enabled": enabled,
            "verified": bool(token_verified or not required),
            "mode": "NONE" if not required else ("VERIFY" if enabled else "SETUP"),
        }

    @classmethod
    async def begin_setup(cls, session: AsyncSession, user: TenantUser, issuer: str) -> dict:
        state = await cls.state(session, user.id)
        if state and state.totp_enabled:
            raise APIError("MFA_ALREADY_ENABLED", "A autenticação em duas etapas já está habilitada.", 409)
        secret = pyotp.random_base32(length=32)
        if state is None:
            state = TenantMFAState(user_id=user.id)
            session.add(state)
        state.totp_secret_encrypted = secret_cipher.encrypt(secret)
        state.totp_enabled = False
        state.confirmed_at = None
        await session.commit()
        return _setup_payload(secret=secret, email=str(user.email), issuer=issuer)

    @classmethod
    async def verify(cls, session: AsyncSession, user: TenantUser, code: str, *, enable: bool = False) -> TenantMFAState:
        normalized = _normalized_code(code)
        state = await cls.state(session, user.id)
        if state is None or not state.totp_secret_encrypted:
            raise APIError("MFA_SETUP_REQUIRED", "Configure primeiro a autenticação em duas etapas.", 428)
        try:
            secret = secret_cipher.decrypt(state.totp_secret_encrypted)
        except Exception as exc:
            raise APIError("MFA_SECRET_INVALID", "Não foi possível validar o autenticador configurado.", 409) from exc
        if not pyotp.TOTP(secret).verify(normalized, valid_window=1):
            raise APIError("MFA_CODE_INVALID", "Código do autenticador inválido ou expirado.", 401)
        now = datetime.now(UTC)
        state.last_verified_at = now
        if enable:
            state.totp_enabled = True
            state.confirmed_at = now
        elif not state.totp_enabled:
            raise APIError("MFA_SETUP_REQUIRED", "Confirme primeiro a configuração do autenticador.", 428)
        await session.commit()
        return state

    @classmethod
    async def reset(cls, session: AsyncSession, user: TenantUser) -> None:
        state = await cls.state(session, user.id)
        if state is not None:
            await session.delete(state)
            await session.commit()
