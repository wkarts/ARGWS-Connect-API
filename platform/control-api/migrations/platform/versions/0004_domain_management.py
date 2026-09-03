"""Adiciona metadados de orquestração de domínios por tenant.

Revision ID: 0004_domain_management
Revises: 0003_platform_observability
"""
from alembic import op

revision = "0004_domain_management"
down_revision = "0003_platform_observability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE tenant_domains ADD COLUMN management_mode VARCHAR(32) NOT NULL DEFAULT 'PLATFORM_SUBDOMAIN'")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN dns_provider VARCHAR(32) NOT NULL DEFAULT 'PLATFORM'")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN zone_name VARCHAR(253)")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN zone_id VARCHAR(128)")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN dns_record_type VARCHAR(16) NOT NULL DEFAULT 'CNAME'")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN dns_target VARCHAR(253)")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN dns_proxied BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN nameservers JSONB NOT NULL DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN ownership_verified_at TIMESTAMPTZ")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN last_reconciled_at TIMESTAMPTZ")
    op.execute("ALTER TABLE tenant_domains ADD COLUMN dnssec_status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN'")
    op.execute("CREATE INDEX ix_tenant_domains_management_mode ON tenant_domains(management_mode)")
    op.execute("CREATE INDEX ix_tenant_domains_zone_id ON tenant_domains(zone_id)")
    op.execute("""
        UPDATE tenant_domains
           SET management_mode = CASE
               WHEN domain_type = 'PROVISIONED' THEN 'PLATFORM_SUBDOMAIN'
               ELSE 'EXTERNAL_DNS'
           END,
               dns_provider = CASE
               WHEN domain_type = 'PROVISIONED' THEN 'CLOUDFLARE'
               ELSE 'EXTERNAL'
           END
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tenant_domains_zone_id")
    op.execute("DROP INDEX IF EXISTS ix_tenant_domains_management_mode")
    for column in (
        "dnssec_status",
        "last_reconciled_at",
        "ownership_verified_at",
        "provider_metadata",
        "nameservers",
        "dns_proxied",
        "dns_target",
        "dns_record_type",
        "zone_id",
        "zone_name",
        "dns_provider",
        "management_mode",
    ):
        op.execute(f"ALTER TABLE tenant_domains DROP COLUMN IF EXISTS {column}")
