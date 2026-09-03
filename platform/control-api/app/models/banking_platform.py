from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import PlatformBase, TimestampMixin, UUIDPrimaryKeyMixin


class BankInstitution(UUIDPrimaryKeyMixin, TimestampMixin, PlatformBase):
    """Instituição financeira universal compartilhada entre todos os tenants.

    O registro representa a instituição, não o canal/provider de integração.
    A fonte autoritativa é sincronizável com dados oficiais do Banco Central.
    """

    __tablename__ = "bank_institutions"
    __table_args__ = (
        Index("ix_bank_institutions_bank_code", "bank_code"),
        Index("ix_bank_institutions_ispb", "ispb"),
        Index("ix_bank_institutions_cnpj", "cnpj"),
        Index("ix_bank_institutions_active_name", "active", "short_name"),
    )

    bank_code: Mapped[str | None] = mapped_column(String(3))
    ispb: Mapped[str | None] = mapped_column(String(8))
    cnpj: Mapped[str | None] = mapped_column(String(14))
    legal_name: Mapped[str] = mapped_column(String(255), nullable=False)
    short_name: Mapped[str] = mapped_column(String(160), nullable=False)
    institution_type: Mapped[str | None] = mapped_column(String(100))
    pix_participant: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    str_participant: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    source: Mapped[str] = mapped_column(String(255), nullable=False, default="BCB")
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
