"""Tarefas do domínio financeiro herdado.

Este módulo NÃO é carregado no runtime padrão Connect|API Platform.
Ele existe exclusivamente para preservar o domínio de referência e só é
registrado quando ENABLE_REFERENCE_FINANCIAL_DOMAIN=true.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.core.tenant_context import TenantContext
from app.services.collection_rules import CollectionRuleService
from app.services.notifications import NotificationService
from app.services.outbox import OutboxService
from app.services.recurrence import RecurrenceService
from app.workers.celery_app import celery_app
from app.workers.tasks import for_each_active_tenant, run


@celery_app.task(name="app.tasks.generate_recurring")
def generate_recurring() -> dict[str, int]:
    async def callback(session: Any, _context: TenantContext) -> int:
        return len(await RecurrenceService(session).generate_due())

    return run(for_each_active_tenant(callback))


@celery_app.task(name="app.tasks.process_outbox")
def process_outbox() -> dict[str, int]:
    async def callback(session: Any, _context: TenantContext) -> int:
        return await OutboxService(session).process_pending()

    return run(for_each_active_tenant(callback))


@celery_app.task(name="app.tasks.schedule_collection_notifications")
def schedule_collection_notifications() -> dict[str, int]:
    async def callback(session: Any, context: TenantContext) -> int:
        today = datetime.now(ZoneInfo(context.timezone)).date()
        return await CollectionRuleService(session).schedule_due(
            today=today,
            public_base_url=f"https://{context.hostname}",
        )

    return run(for_each_active_tenant(callback))


@celery_app.task(name="app.tasks.dispatch_notifications")
def dispatch_notifications() -> dict[str, int]:
    async def callback(session: Any, _context: TenantContext) -> int:
        return await NotificationService(session).dispatch_pending()

    return run(for_each_active_tenant(callback))
