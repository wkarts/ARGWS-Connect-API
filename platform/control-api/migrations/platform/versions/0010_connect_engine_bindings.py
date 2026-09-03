"""connect engine bindings

Revision ID: 0010_connect_engine_bindings
Revises: 0009_branding_hierarchy
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010_connect_engine_bindings"
down_revision = "0009_branding_hierarchy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "engine_bindings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("alias", sa.String(80), nullable=False),
        sa.Column("instance_name", sa.String(180), nullable=False),
        sa.Column("provider", sa.String(64), nullable=False, server_default="WHATSAPP-BAILEYS"),
        sa.Column("status", sa.String(32), nullable=False, server_default="CREATED"),
        sa.Column("capabilities", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("last_state", sa.String(64)),
        sa.Column("last_error", sa.Text()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "instance_name", name="uq_engine_bindings_tenant_instance"),
        sa.UniqueConstraint("instance_name", name="uq_engine_bindings_instance_name"),
    )
    op.create_index("ix_engine_bindings_tenant_id", "engine_bindings", ["tenant_id"])
    op.create_index("ix_engine_bindings_status", "engine_bindings", ["status"])
    op.create_index("ix_engine_bindings_tenant_status", "engine_bindings", ["tenant_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_engine_bindings_tenant_status", table_name="engine_bindings")
    op.drop_index("ix_engine_bindings_status", table_name="engine_bindings")
    op.drop_index("ix_engine_bindings_tenant_id", table_name="engine_bindings")
    op.drop_table("engine_bindings")
