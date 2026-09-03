from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform import PlatformAuditLog
from app.models.tenant import TenantAuditLog


async def platform_audit(
    session: AsyncSession,
    *,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    actor_id: str | None = None,
    tenant_id: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
    correlation_id: str | None = None,
) -> None:
    """Registra evento append-only no Control Plane.

    Algumas operações são auditadas antes de existir uma entidade persistida
    específica (por exemplo, solicitar um backup). Nesses casos ``entity_id`` é
    legitimamente nulo e a auditoria não pode transformar uma operação já
    disparada em erro HTTP 500.
    """
    session.add(
        PlatformAuditLog(
            actor_id=actor_id,
            tenant_id=tenant_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before=before,
            after=after,
            context=context or {},
            correlation_id=correlation_id,
        )
    )


async def tenant_audit(
    session: AsyncSession,
    *,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    actor_id: str | None = None,
    company_id: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
    correlation_id: str | None = None,
) -> None:
    """Registra evento append-only no banco do tenant."""
    session.add(
        TenantAuditLog(
            actor_id=actor_id,
            company_id=company_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before=before,
            after=after,
            context=context or {},
            correlation_id=correlation_id,
        )
    )
