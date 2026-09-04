"""platform password reset tokens

Revision ID: 0011_platform_password_reset
Revises: 0010_connect_engine_bindings
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011_platform_password_reset"
down_revision = "0010_connect_engine_bindings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_password_reset_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("token_hash", name="uq_platform_password_reset_tokens_hash"),
    )
    op.create_index(
        "ix_platform_password_reset_tokens_user_id",
        "platform_password_reset_tokens",
        ["user_id"],
    )
    op.create_index(
        "ix_platform_password_reset_tokens_expires_at",
        "platform_password_reset_tokens",
        ["expires_at"],
    )
    op.create_index(
        "ix_platform_password_reset_tokens_user_active",
        "platform_password_reset_tokens",
        ["user_id", "used_at", "expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_platform_password_reset_tokens_user_active",
        table_name="platform_password_reset_tokens",
    )
    op.drop_index(
        "ix_platform_password_reset_tokens_expires_at",
        table_name="platform_password_reset_tokens",
    )
    op.drop_index(
        "ix_platform_password_reset_tokens_user_id",
        table_name="platform_password_reset_tokens",
    )
    op.drop_table("platform_password_reset_tokens")
