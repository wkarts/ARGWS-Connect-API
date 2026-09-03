"""Adiciona builder versionado da landing pública.

Revision ID: 0006_landing_builder
Revises: 0005_control_plane_mfa
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006_landing_builder"
down_revision = "0005_control_plane_mfa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_landing_pages",
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("draft_document", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("draft_css", sa.Text(), nullable=False, server_default=""),
        sa.Column("published_document", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("published_css", sa.Text(), nullable=False, server_default=""),
        sa.Column("current_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("published_revision", sa.Integer(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["published_by"], ["platform_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index("ix_platform_landing_pages_key", "platform_landing_pages", ["key"], unique=True)
    op.create_table(
        "platform_landing_revisions",
        sa.Column("landing_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("custom_css", sa.Text(), nullable=False, server_default=""),
        sa.Column("note", sa.String(length=240), nullable=True),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["platform_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["landing_id"], ["platform_landing_pages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("landing_id", "revision", name="uq_platform_landing_revision"),
    )
    op.create_index("ix_platform_landing_revisions_landing_id", "platform_landing_revisions", ["landing_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_platform_landing_revisions_landing_id", table_name="platform_landing_revisions")
    op.drop_table("platform_landing_revisions")
    op.drop_index("ix_platform_landing_pages_key", table_name="platform_landing_pages")
    op.drop_table("platform_landing_pages")
