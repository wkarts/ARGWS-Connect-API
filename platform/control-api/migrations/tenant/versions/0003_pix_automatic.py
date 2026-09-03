"""Adiciona ciclo completo de Pix Automático.

Revision ID: 0003_pix_automatic
Revises: 0002_tenant_complete
"""
from alembic import op

revision = "0003_pix_automatic"
down_revision = "0002_tenant_complete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE pix_automatic_mandates (
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
        bank_agreement_id UUID NOT NULL REFERENCES bank_agreements(id) ON DELETE RESTRICT,
        provider VARCHAR(64) NOT NULL,
        external_id VARCHAR(160) NOT NULL,
        frequency VARCHAR(32) NOT NULL,
        start_date DATE NOT NULL,
        finish_date DATE,
        fixed_amount NUMERIC(18,2),
        min_limit_value NUMERIC(18,2),
        description VARCHAR(120) NOT NULL,
        payment_creation_mode VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
        retry_policy VARCHAR(64) NOT NULL DEFAULT 'NOT_ALLOWED',
        status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
        authorization_url TEXT,
        qr_copy_paste TEXT,
        qr_encoded_image TEXT,
        raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        activated_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        last_synced_at TIMESTAMPTZ,
        last_error TEXT,
        id UUID PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT uq_pix_automatic_provider_external UNIQUE(provider, external_id)
    )
    """)
    op.execute("CREATE INDEX ix_pix_automatic_company_status ON pix_automatic_mandates(company_id, status)")
    op.execute("CREATE INDEX ix_pix_automatic_mandates_customer_id ON pix_automatic_mandates(customer_id)")
    op.execute("CREATE INDEX ix_pix_automatic_mandates_contract_id ON pix_automatic_mandates(contract_id)")
    op.execute("CREATE INDEX ix_pix_automatic_mandates_bank_agreement_id ON pix_automatic_mandates(bank_agreement_id)")
    op.execute("CREATE INDEX ix_pix_automatic_mandates_status ON pix_automatic_mandates(status)")
    op.execute("""
    CREATE TABLE pix_automatic_instructions (
        mandate_id UUID NOT NULL REFERENCES pix_automatic_mandates(id) ON DELETE CASCADE,
        receivable_id UUID REFERENCES receivables(id) ON DELETE SET NULL,
        charge_id UUID REFERENCES charges(id) ON DELETE SET NULL,
        provider VARCHAR(64) NOT NULL,
        external_id VARCHAR(180) NOT NULL,
        due_date DATE NOT NULL,
        amount NUMERIC(18,2) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_error TEXT,
        id UUID PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT uq_pix_automatic_instruction_external UNIQUE(provider, external_id)
    )
    """)
    op.execute("CREATE INDEX ix_pix_automatic_instruction_due ON pix_automatic_instructions(mandate_id, due_date)")
    op.execute("CREATE INDEX ix_pix_automatic_instructions_receivable_id ON pix_automatic_instructions(receivable_id)")
    op.execute("CREATE INDEX ix_pix_automatic_instructions_charge_id ON pix_automatic_instructions(charge_id)")
    op.execute("CREATE INDEX ix_pix_automatic_instructions_status ON pix_automatic_instructions(status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS pix_automatic_instructions CASCADE")
    op.execute("DROP TABLE IF EXISTS pix_automatic_mandates CASCADE")
