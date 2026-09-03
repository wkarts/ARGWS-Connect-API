"""Adiciona TOTP obrigatório aos usuários humanos do Control Plane.

Revision ID: 0005_control_plane_mfa
Revises: 0004_domain_management
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005_control_plane_mfa"
down_revision = "0004_domain_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_user_mfa_states",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("totp_secret_encrypted", sa.Text(), nullable=False, server_default=""),
        sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["platform_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_platform_user_mfa_states_user"),
    )
    op.create_index("ix_platform_user_mfa_states_user_id", "platform_user_mfa_states", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_platform_user_mfa_states_user_id", table_name="platform_user_mfa_states")
    op.drop_table("platform_user_mfa_states")
