"""banking provider framework

Revision ID: 0005_banking_provider_framework
Revises: 0004_user_mfa
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005_banking_provider_framework"
down_revision = "0004_user_mfa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bank_accounts", sa.Column("ispb", sa.String(8), nullable=True))
    # Referência lógica ao catálogo do Control Plane. Não há FK cross-database.
    op.add_column("bank_accounts", sa.Column("institution_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_bank_accounts_ispb", "bank_accounts", ["ispb"])
    op.create_index("ix_bank_accounts_institution_id", "bank_accounts", ["institution_id"])

    op.create_table(
        "bank_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bank_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("environment", sa.String(32), nullable=False, server_default="SANDBOX"),
        sa.Column("auth_type", sa.String(64), nullable=False, server_default="NONE"),
        sa.Column("encrypted_credentials", sa.Text(), nullable=False, server_default=""),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("credential_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("certificate_issuer", sa.String(500), nullable=True),
        sa.Column("certificate_serial", sa.String(160), nullable=True),
        sa.Column("certificate_subject", sa.String(500), nullable=True),
        sa.Column("certificate_not_before", sa.DateTime(timezone=True), nullable=True),
        sa.Column("certificate_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("certificate_fingerprint_sha256", sa.String(64), nullable=True),
        sa.Column("last_health_status", sa.String(40), nullable=True),
        sa.Column("last_health_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_bank_connections_company_provider", "bank_connections", ["company_id", "provider"])
    op.create_index("ix_bank_connections_bank_account_id", "bank_connections", ["bank_account_id"])
    op.create_index("ix_bank_connections_health", "bank_connections", ["last_health_status", "last_health_at"])
    op.create_index("ix_bank_connections_certificate_expires", "bank_connections", ["certificate_expires_at"])

    op.add_column(
        "bank_agreements",
        sa.Column("bank_connection_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_bank_agreements_connection",
        "bank_agreements",
        "bank_connections",
        ["bank_connection_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_bank_agreements_connection", "bank_agreements", ["bank_connection_id"])

    op.create_table(
        "bank_sync_states",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_type", sa.String(64), nullable=False),
        sa.Column("last_cursor", sa.Text(), nullable=True),
        sa.Column("last_sync_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("connection_id", "resource_type", name="uq_bank_sync_connection_resource"),
    )
    op.create_index("ix_bank_sync_states_connection", "bank_sync_states", ["connection_id"])

    op.create_table(
        "bank_operations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bank_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("operation_type", sa.String(80), nullable=False),
        sa.Column("idempotency_key", sa.String(180), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("provider_operation_id", sa.String(180), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("response_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("connection_id", "operation_type", "idempotency_key", name="uq_bank_operation_idempotency"),
    )
    op.create_index("ix_bank_operation_status", "bank_operations", ["provider", "operation_type", "status"])

    op.add_column("bank_transactions", sa.Column("provider", sa.String(64), nullable=True))
    op.add_column("bank_transactions", sa.Column("provider_transaction_id", sa.String(180), nullable=True))
    op.add_column("bank_transactions", sa.Column("txid", sa.String(100), nullable=True))
    op.add_column("bank_transactions", sa.Column("bank_reference", sa.String(180), nullable=True))
    op.add_column("bank_transactions", sa.Column("source", sa.String(32), nullable=False, server_default="FILE_IMPORT"))
    op.create_index("ix_bank_transactions_provider_id", "bank_transactions", ["provider", "provider_transaction_id"])
    op.create_index("ix_bank_transactions_txid", "bank_transactions", ["txid"])
    op.create_index("ix_bank_transactions_bank_reference", "bank_transactions", ["bank_reference"])

    op.add_column("webhook_events", sa.Column("bank_connection_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("webhook_events", sa.Column("headers_sanitized", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.create_foreign_key(
        "fk_webhook_events_bank_connection",
        "webhook_events",
        "bank_connections",
        ["bank_connection_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_webhook_events_connection", "webhook_events", ["bank_connection_id"])


def downgrade() -> None:
    op.drop_index("ix_webhook_events_connection", table_name="webhook_events")
    op.drop_constraint("fk_webhook_events_bank_connection", "webhook_events", type_="foreignkey")
    op.drop_column("webhook_events", "headers_sanitized")
    op.drop_column("webhook_events", "bank_connection_id")

    op.drop_index("ix_bank_transactions_bank_reference", table_name="bank_transactions")
    op.drop_index("ix_bank_transactions_txid", table_name="bank_transactions")
    op.drop_index("ix_bank_transactions_provider_id", table_name="bank_transactions")
    op.drop_column("bank_transactions", "source")
    op.drop_column("bank_transactions", "bank_reference")
    op.drop_column("bank_transactions", "txid")
    op.drop_column("bank_transactions", "provider_transaction_id")
    op.drop_column("bank_transactions", "provider")

    op.drop_index("ix_bank_operation_status", table_name="bank_operations")
    op.drop_table("bank_operations")
    op.drop_index("ix_bank_sync_states_connection", table_name="bank_sync_states")
    op.drop_table("bank_sync_states")

    op.drop_index("ix_bank_agreements_connection", table_name="bank_agreements")
    op.drop_constraint("fk_bank_agreements_connection", "bank_agreements", type_="foreignkey")
    op.drop_column("bank_agreements", "bank_connection_id")

    op.drop_index("ix_bank_connections_certificate_expires", table_name="bank_connections")
    op.drop_index("ix_bank_connections_health", table_name="bank_connections")
    op.drop_index("ix_bank_connections_bank_account_id", table_name="bank_connections")
    op.drop_index("ix_bank_connections_company_provider", table_name="bank_connections")
    op.drop_table("bank_connections")

    op.drop_index("ix_bank_accounts_institution_id", table_name="bank_accounts")
    op.drop_index("ix_bank_accounts_ispb", table_name="bank_accounts")
    op.drop_column("bank_accounts", "institution_id")
    op.drop_column("bank_accounts", "ispb")
