from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import PlatformBase, TimestampMixin, UUIDPrimaryKeyMixin


class PlatformMFAState(UUIDPrimaryKeyMixin, TimestampMixin, PlatformBase):
    """Estado TOTP dos usuários humanos do Control Plane.

    Mantém o segredo criptografado separado do cadastro administrativo e usa o
    mesmo desenho de segurança adotado nos tenants.
    """

    __tablename__ = "platform_user_mfa_states"
    __table_args__ = (UniqueConstraint("user_id", name="uq_platform_user_mfa_states_user"),)

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("platform_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    totp_secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False, default="")
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PlatformPasswordResetToken(UUIDPrimaryKeyMixin, TimestampMixin, PlatformBase):
    """Token de recuperação de senha de uso único do Control Plane.

    O token recebido pelo usuário nunca é persistido. Somente seu SHA-256 é
    armazenado, permitindo validação sem transformar o banco em fonte do link.
    """

    __tablename__ = "platform_password_reset_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_platform_password_reset_tokens_hash"),
        Index(
            "ix_platform_password_reset_tokens_user_active",
            "user_id",
            "used_at",
            "expires_at",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("platform_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
