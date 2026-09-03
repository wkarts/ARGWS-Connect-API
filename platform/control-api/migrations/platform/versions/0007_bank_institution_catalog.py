"""bank institution catalog

Revision ID: 0007_bank_institution_catalog
Revises: 0006_landing_builder
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007_bank_institution_catalog"
down_revision = "0006_landing_builder"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bank_institutions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("bank_code", sa.String(3), nullable=True),
        sa.Column("ispb", sa.String(8), nullable=True),
        sa.Column("cnpj", sa.String(14), nullable=True),
        sa.Column("legal_name", sa.String(255), nullable=False),
        sa.Column("short_name", sa.String(160), nullable=False),
        sa.Column("institution_type", sa.String(100), nullable=True),
        sa.Column("pix_participant", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("str_participant", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("source", sa.String(255), nullable=False, server_default="BCB"),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_bank_institutions_bank_code", "bank_institutions", ["bank_code"])
    op.create_index("ix_bank_institutions_ispb", "bank_institutions", ["ispb"])
    op.create_index("ix_bank_institutions_cnpj", "bank_institutions", ["cnpj"])
    op.create_index("ix_bank_institutions_active_name", "bank_institutions", ["active", "short_name"])
    op.create_unique_constraint("uq_bank_institutions_ispb", "bank_institutions", ["ispb"])


def downgrade() -> None:
    op.drop_constraint("uq_bank_institutions_ispb", "bank_institutions", type_="unique")
    op.drop_index("ix_bank_institutions_active_name", table_name="bank_institutions")
    op.drop_index("ix_bank_institutions_cnpj", table_name="bank_institutions")
    op.drop_index("ix_bank_institutions_ispb", table_name="bank_institutions")
    op.drop_index("ix_bank_institutions_bank_code", table_name="bank_institutions")
    op.drop_table("bank_institutions")
