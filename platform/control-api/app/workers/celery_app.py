from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings


def parse_cron_expression(value: str) -> crontab:
    """Converte cron UNIX de cinco campos para o scheduler Celery."""

    parts = value.strip().split()
    if len(parts) != 5:
        raise ValueError("BACKUP_CRON deve usar cinco campos: minuto hora dia mês semana.")
    minute, hour, day_of_month, month_of_year, day_of_week = parts
    return crontab(
        minute=minute,
        hour=hour,
        day_of_month=day_of_month,
        month_of_year=month_of_year,
        day_of_week=day_of_week,
    )


includes = ["app.workers.tasks"]
if settings.enable_reference_financial_domain:
    includes.append("app.workers.legacy_financial_tasks")

celery_app = Celery(
    "connect_api_platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=includes,
)

routes: dict[str, dict[str, str]] = {
    "app.tasks.provision_tenant": {"queue": "connect.provisioning"},
    "app.tasks.backup_all": {"queue": "connect.backups"},
    "app.tasks.backup_tenant": {"queue": "connect.backups"},
    "app.tasks.dispatch_outbound_webhooks": {"queue": "connect.webhooks"},
    "app.tasks.capture_connect_api_usage": {"queue": "connect.default"},
}

beat_schedule: dict[str, dict[str, object]] = {
    "outbound-webhooks-every-minute": {
        "task": "app.tasks.dispatch_outbound_webhooks",
        "schedule": crontab(minute="*"),
    },
    "tenant-usage-hourly": {
        "task": "app.tasks.capture_connect_api_usage",
        "schedule": crontab(minute="7"),
    },
    "backup-configured-cron": {
        "task": "app.tasks.backup_all",
        "schedule": parse_cron_expression(settings.backup_cron),
    },
}

if settings.enable_reference_financial_domain:
    routes.update(
        {
            "app.tasks.generate_recurring": {"queue": "connect.legacy.billing"},
            "app.tasks.process_outbox": {"queue": "connect.legacy.outbox"},
            "app.tasks.schedule_collection_notifications": {"queue": "connect.legacy.notifications"},
            "app.tasks.dispatch_notifications": {"queue": "connect.legacy.notifications"},
        }
    )
    beat_schedule.update(
        {
            "legacy-financial-recurrence-every-15-minutes": {
                "task": "app.tasks.generate_recurring",
                "schedule": crontab(minute="*/15"),
            },
            "legacy-financial-outbox-every-minute": {
                "task": "app.tasks.process_outbox",
                "schedule": crontab(minute="*"),
            },
            "legacy-financial-collection-rules-every-15-minutes": {
                "task": "app.tasks.schedule_collection_notifications",
                "schedule": crontab(minute="*/15"),
            },
            "legacy-financial-notifications-every-minute": {
                "task": "app.tasks.dispatch_notifications",
                "schedule": crontab(minute="*"),
            },
        }
    )

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone=settings.app_timezone,
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    worker_enable_remote_control=False,
    worker_cancel_long_running_tasks_on_connection_loss=True,
    task_always_eager=settings.celery_task_always_eager,
    task_routes=routes,
    task_default_queue="connect.default",
    task_default_exchange="connect",
    task_default_routing_key="connect.default",
    beat_schedule=beat_schedule,
)
