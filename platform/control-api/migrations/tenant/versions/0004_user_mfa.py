"""Adiciona autenticação em duas etapas TOTP por usuário.

Revision ID: 0004_user_mfa
Revises: 0003_pix_automatic
"""
from alembic import op

revision = "0004_user_mfa"
down_revision = "0003_pix_automatic"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE user_mfa_states (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        totp_secret_encrypted TEXT NOT NULL DEFAULT '',
        totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        confirmed_at TIMESTAMPTZ,
        last_verified_at TIMESTAMPTZ,
        id UUID PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT uq_user_mfa_states_user UNIQUE(user_id)
    )
    """)
    op.execute("CREATE INDEX ix_user_mfa_states_user_id ON user_mfa_states(user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_mfa_states CASCADE")
