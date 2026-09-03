from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import TenantBase, TimestampMixin, UUIDPrimaryKeyMixin


class TenantMFAState(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    """Estado TOTP separado do cadastro do usuário.

    Mantém segredo criptografado fora do modelo principal de usuário e permite
    evoluir outros fatores sem alterar novamente a tabela users.
    """

    __tablename__ = "user_mfa_states"
    __table_args__ = (UniqueConstraint("user_id", name="uq_user_mfa_states_user"),)

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    totp_secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False, default="")
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
