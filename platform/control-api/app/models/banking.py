from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, event, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import TenantBase, TimestampMixin, UUIDPrimaryKeyMixin


class BankConnection(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "bank_connections"
    __table_args__ = (
        Index("ix_bank_connections_company_provider", "company_id", "provider"),
        Index("ix_bank_connections_health", "last_health_status", "last_health_at"),
    )

    company_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bank_account_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    environment: Mapped[str] = mapped_column(String(32), nullable=False, default="SANDBOX")
    auth_type: Mapped[str] = mapped_column(String(64), nullable=False, default="NONE")
    encrypted_credentials: Mapped[str] = mapped_column(Text, nullable=False, default="")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    credential_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    certificate_issuer: Mapped[str | None] = mapped_column(String(500))
    certificate_serial: Mapped[str | None] = mapped_column(String(160))
    certificate_subject: Mapped[str | None] = mapped_column(String(500))
    certificate_not_before: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    certificate_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    certificate_fingerprint_sha256: Mapped[str | None] = mapped_column(String(64))
    last_health_status: Mapped[str | None] = mapped_column(String(40), index=True)
    last_health_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True)


@event.listens_for(BankConnection, "before_insert")
@event.listens_for(BankConnection, "before_update")
def _enforce_bank_connection_provider_binding(_mapper: Any, db_connection: Any, target: BankConnection) -> None:
    """Última barreira contra associação de uma conta ao provider de outro banco.

    A regra vive também na fronteira de persistência para cobrir rotas HTTP,
    workers, scripts internos e futuras integrações. BankConnection representa
    exclusivamente DIRECT_API; providers implementados somente por CNAB não
    podem ser persistidos como conexão HTTP.
    """

    from app.core.errors import APIError
    from app.providers.banking.core.capabilities import BankingIntegrationMode
    from app.providers.banking.registry import banking_providers
    from app.services.banking_binding import assert_provider_matches_bank_identity

    provider_code = str(target.provider or "").strip().upper()
    manifest = banking_providers.manifest(provider_code)
    if not banking_providers.mode_available(provider_code, BankingIntegrationMode.DIRECT_API):
        raise APIError(
            "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
            "BankConnection só pode usar provider com executor DIRECT_API instalado.",
            422,
            {
                "provider": provider_code,
                "implemented_modes": sorted(
                    mode.value for mode in manifest.effective_implemented_modes()
                ),
            },
        )

    row = db_connection.execute(
        text("SELECT company_id, bank_code, ispb FROM bank_accounts WHERE id=:account_id"),
        {"account_id": str(target.bank_account_id)},
    ).mappings().first()
    if row is None:
        raise APIError("BANK_ACCOUNT_NOT_FOUND", "Conta bancária da conexão não foi encontrada.", 404)
    if str(row["company_id"]) != str(target.company_id):
        raise APIError(
            "BANK_CONNECTION_COMPANY_MISMATCH",
            "A conta bancária e a conexão pertencem a empresas diferentes.",
            409,
        )
    assert_provider_matches_bank_identity(
        manifest,
        bank_code=row["bank_code"],
        ispb=row["ispb"],
    )


class BankSyncState(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "bank_sync_states"
    __table_args__ = (
        UniqueConstraint("connection_id", "resource_type", name="uq_bank_sync_connection_resource"),
    )

    connection_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    last_cursor: Mapped[str | None] = mapped_column(Text)
    last_sync_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class BankOperation(UUIDPrimaryKeyMixin, TimestampMixin, TenantBase):
    __tablename__ = "bank_operations"
    __table_args__ = (
        UniqueConstraint(
            "connection_id", "operation_type", "idempotency_key",
            name="uq_bank_operation_idempotency",
        ),
        Index("ix_bank_operation_status", "provider", "operation_type", "status"),
    )

    connection_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    operation_type: Mapped[str] = mapped_column(String(80), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(180), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_operation_id: Mapped[str | None] = mapped_column(String(180))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    response_summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
