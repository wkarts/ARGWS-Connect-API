"""Adiciona logs operacionais estruturados da plataforma.

Revision ID: 0003_platform_observability
Revises: 0002_control_complete
"""
from alembic import op

revision = "0003_platform_observability"
down_revision = "0002_control_complete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE platform_runtime_logs (
        tenant_id UUID,
        actor_id UUID,
        source VARCHAR(32) NOT NULL DEFAULT 'backend',
        service VARCHAR(80) NOT NULL DEFAULT 'api',
        level VARCHAR(16) NOT NULL DEFAULT 'INFO',
        event VARCHAR(160) NOT NULL,
        message TEXT NOT NULL,
        request_id VARCHAR(64),
        correlation_id VARCHAR(64),
        method VARCHAR(12),
        path VARCHAR(500),
        status_code INTEGER,
        duration_ms INTEGER,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMPTZ NOT NULL,
        id UUID PRIMARY KEY
    )
    """)
    op.execute("CREATE INDEX ix_platform_runtime_logs_tenant_id ON platform_runtime_logs(tenant_id)")
    op.execute("CREATE INDEX ix_platform_runtime_logs_actor_id ON platform_runtime_logs(actor_id)")
    op.execute("CREATE INDEX ix_platform_runtime_logs_source ON platform_runtime_logs(source)")
    op.execute("CREATE INDEX ix_platform_runtime_logs_service ON platform_runtime_logs(service)")
    op.execute("CREATE INDEX ix_platform_runtime_logs_level ON platform_runtime_logs(level)")
    op.execute("CREATE INDEX ix_platform_runtime_logs_event ON platform_runtime_logs(event)")
    op.execute("CREATE INDEX ix_platform_runtime_logs_correlation_id ON platform_runtime_logs(correlation_id)")
    op.execute("CREATE INDEX ix_platform_runtime_logs_occurred_at ON platform_runtime_logs(occurred_at)")
    op.execute("CREATE INDEX ix_runtime_logs_occurred_level ON platform_runtime_logs(occurred_at, level)")
    op.execute("CREATE INDEX ix_runtime_logs_tenant_occurred ON platform_runtime_logs(tenant_id, occurred_at)")
    op.execute("CREATE INDEX ix_runtime_logs_service_occurred ON platform_runtime_logs(service, occurred_at)")
    op.execute("CREATE INDEX ix_runtime_logs_request_id ON platform_runtime_logs(request_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS platform_runtime_logs CASCADE")
