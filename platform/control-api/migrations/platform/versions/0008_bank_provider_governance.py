"""bank provider governance and entitlements

Revision ID: 0008_bank_provider_governance
Revises: 0007_bank_institution_catalog
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008_bank_provider_governance"
down_revision = "0007_bank_institution_catalog"
branch_labels = None
depends_on = None


def _timestamps() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def upgrade() -> None:
    op.create_table(
        "platform_bank_providers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("institution_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bank_institutions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("display_name", sa.String(160), nullable=False),
        sa.Column("driver_version", sa.String(64), nullable=True),
        sa.Column("driver_status", sa.String(40), nullable=False, server_default="CATALOG_ONLY"),
        sa.Column("driver_installed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("globally_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("tenant_visible", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("integration_modes", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("capabilities", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("environments", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("documentation_status", sa.String(40), nullable=False, server_default="UNKNOWN"),
        sa.Column("documentation_version", sa.String(120), nullable=True),
        sa.Column("documentation_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("documentation_hash", sa.String(64), nullable=True),
        sa.Column("sandbox_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("homologation_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("production_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_health_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_health_check_status", sa.String(40), nullable=True),
        sa.Column("source_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("notes", sa.Text(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("code", name="uq_platform_bank_providers_code"),
    )
    op.create_index("ix_platform_bank_providers_code", "platform_bank_providers", ["code"])
    op.create_index("ix_platform_bank_providers_enabled", "platform_bank_providers", ["globally_enabled", "tenant_visible"])
    op.create_index("ix_platform_bank_providers_status", "platform_bank_providers", ["driver_status", "driver_installed"])
    op.create_table(
        "plan_bank_provider_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False, server_default="ALL"),
        *_timestamps(),
        sa.UniqueConstraint("plan_id", name="uq_plan_bank_provider_policies_plan"),
    )
    op.create_index("ix_plan_bank_provider_policies_mode", "plan_bank_provider_policies", ["mode"])
    op.create_table(
        "plan_bank_provider_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("policy_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("plan_bank_provider_policies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider_code", sa.String(64), sa.ForeignKey("platform_bank_providers.code", ondelete="CASCADE"), nullable=False),
        sa.Column("allowed", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
        sa.UniqueConstraint("policy_id", "provider_code", name="uq_plan_bank_provider_rule"),
    )
    op.create_index("ix_plan_bank_provider_rules_provider", "plan_bank_provider_rules", ["provider_code", "allowed"])
    op.create_table(
        "tenant_bank_provider_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False, server_default="INHERIT"),
        *_timestamps(),
        sa.UniqueConstraint("tenant_id", name="uq_tenant_bank_provider_policies_tenant"),
    )
    op.create_index("ix_tenant_bank_provider_policies_mode", "tenant_bank_provider_policies", ["mode"])
    op.create_table(
        "tenant_bank_provider_overrides",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider_code", sa.String(64), sa.ForeignKey("platform_bank_providers.code", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(16), nullable=False, server_default="INHERIT"),
        *_timestamps(),
        sa.UniqueConstraint("tenant_id", "provider_code", name="uq_tenant_bank_provider_override"),
    )
    op.create_index("ix_tenant_bank_provider_overrides_provider", "tenant_bank_provider_overrides", ["provider_code", "action"])


def downgrade() -> None:
    op.drop_index("ix_tenant_bank_provider_overrides_provider", table_name="tenant_bank_provider_overrides")
    op.drop_table("tenant_bank_provider_overrides")
    op.drop_index("ix_tenant_bank_provider_policies_mode", table_name="tenant_bank_provider_policies")
    op.drop_table("tenant_bank_provider_policies")
    op.drop_index("ix_plan_bank_provider_rules_provider", table_name="plan_bank_provider_rules")
    op.drop_table("plan_bank_provider_rules")
    op.drop_index("ix_plan_bank_provider_policies_mode", table_name="plan_bank_provider_policies")
    op.drop_table("plan_bank_provider_policies")
    op.drop_index("ix_platform_bank_providers_status", table_name="platform_bank_providers")
    op.drop_index("ix_platform_bank_providers_enabled", table_name="platform_bank_providers")
    op.drop_index("ix_platform_bank_providers_code", table_name="platform_bank_providers")
    op.drop_table("platform_bank_providers")
