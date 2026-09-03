"""partner and hierarchical branding

Revision ID: 0009_branding_hierarchy
Revises: 0008_bank_provider_governance
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009_branding_hierarchy"
down_revision = "0008_bank_provider_governance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "branding_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("owner_type", sa.String(16), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("short_name", sa.String(80)),
        sa.Column("logo_light_url", sa.Text()),
        sa.Column("logo_dark_url", sa.Text()),
        sa.Column("favicon_url", sa.Text()),
        sa.Column("apple_touch_icon_url", sa.Text()),
        sa.Column("pwa_icon_192_url", sa.Text()),
        sa.Column("pwa_icon_512_url", sa.Text()),
        sa.Column("primary_color", sa.String(16), nullable=False, server_default="#2563EB"),
        sa.Column("accent_color", sa.String(16), nullable=False, server_default="#06B6D4"),
        sa.Column("background_color", sa.String(16), nullable=False, server_default="#F8FAFC"),
        sa.Column("surface_color", sa.String(16), nullable=False, server_default="#FFFFFF"),
        sa.Column("text_color", sa.String(16), nullable=False, server_default="#0F172A"),
        sa.Column("manifest_name", sa.String(180)),
        sa.Column("manifest_short_name", sa.String(80)),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("owner_type", "owner_id", "version", name="uq_branding_profiles_owner_version"),
    )
    op.create_index("ix_branding_profiles_status", "branding_profiles", ["status"])
    op.create_index("ix_branding_profiles_owner_status", "branding_profiles", ["owner_type", "owner_id", "status"])

    op.create_table(
        "partners",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("hostname", sa.String(253)),
        sa.Column("branding_mode", sa.String(16), nullable=False, server_default="PLATFORM"),
        sa.Column("branding_profile_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branding_profiles.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("slug", name="uq_partners_slug"),
        sa.UniqueConstraint("hostname", name="uq_partners_hostname"),
    )
    op.create_index("ix_partners_slug", "partners", ["slug"])
    op.create_index("ix_partners_status", "partners", ["status"])
    op.create_index("ix_partners_hostname", "partners", ["hostname"])

    op.add_column("tenants", sa.Column("partner_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("tenants", sa.Column("branding_mode", sa.String(16), nullable=False, server_default="INHERIT"))
    op.add_column("tenants", sa.Column("branding_profile_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_tenants_partner_id_partners", "tenants", "partners", ["partner_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_tenants_branding_profile_id_branding_profiles", "tenants", "branding_profiles", ["branding_profile_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_tenants_partner_id", "tenants", ["partner_id"])


def downgrade() -> None:
    op.drop_index("ix_tenants_partner_id", table_name="tenants")
    op.drop_constraint("fk_tenants_branding_profile_id_branding_profiles", "tenants", type_="foreignkey")
    op.drop_constraint("fk_tenants_partner_id_partners", "tenants", type_="foreignkey")
    op.drop_column("tenants", "branding_profile_id")
    op.drop_column("tenants", "branding_mode")
    op.drop_column("tenants", "partner_id")
    op.drop_index("ix_partners_hostname", table_name="partners")
    op.drop_index("ix_partners_status", table_name="partners")
    op.drop_index("ix_partners_slug", table_name="partners")
    op.drop_table("partners")
    op.drop_index("ix_branding_profiles_owner_status", table_name="branding_profiles")
    op.drop_index("ix_branding_profiles_status", table_name="branding_profiles")
    op.drop_table("branding_profiles")
