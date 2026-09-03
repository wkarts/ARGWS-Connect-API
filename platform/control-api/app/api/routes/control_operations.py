from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_control_roles
from app.core.config import settings
from app.db.platform import get_platform_session
from app.models.platform import BackupRun
from app.providers.storage import S3StorageProvider
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import platform_audit
from app.workers.tasks import backup_all, backup_tenant

router = APIRouter(prefix="/api/control/v1", tags=["Control Plane - Operação"])


async def serialize_backup(item: BackupRun) -> dict:
    download_url = None
    s3 = item.destinations.get("s3", {}) if item.destinations else {}
    if s3.get("bucket") and s3.get("key"):
        try:
            download_url = await S3StorageProvider().presigned_url(str(s3["bucket"]), str(s3["key"]), expires=900)
        except Exception:
            download_url = None
    return {
        "id": str(item.id),
        "scope": item.scope,
        "tenant_id": str(item.tenant_id) if item.tenant_id else None,
        "status": item.status,
        "path": item.path,
        "checksum": item.checksum,
        "size_bytes": item.size_bytes,
        "manifest": item.manifest,
        "destinations": item.destinations,
        "started_at": item.started_at.isoformat() if item.started_at else None,
        "finished_at": item.finished_at.isoformat() if item.finished_at else None,
        "last_error": item.last_error,
        "created_at": item.created_at.isoformat(),
        "download_url": download_url,
    }


@router.get("/backups", response_model=SuccessResponse[list[dict]])
async def list_backups(
    limit: int = Query(default=50, ge=1, le=500),
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR", "PLATFORM_SUPPORT")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    items = list((await session.execute(select(BackupRun).order_by(BackupRun.created_at.desc()).limit(limit))).scalars())
    return SuccessResponse(data=[await serialize_backup(item) for item in items])


@router.post("/backups", response_model=SuccessResponse[dict], status_code=202)
async def run_backup(
    tenant_id: UUID | None = Query(default=None),
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    scope = "TENANT" if tenant_id else "FULL"
    task = (
        backup_tenant.apply_async(args=[str(tenant_id)], queue="connect.backups")
        if tenant_id
        else backup_all.apply_async(queue="connect.backups")
    )
    await platform_audit(
        session,
        action="backup.requested",
        entity_type="BackupRun",
        actor_id=user.id,
        tenant_id=str(tenant_id) if tenant_id else None,
        after={"celery_task_id": task.id, "scope": scope},
    )
    await session.commit()
    return SuccessResponse(data={
        "queued": True,
        "task_id": task.id,
        "scope": scope,
        "tenant_id": str(tenant_id) if tenant_id else None,
    })


@router.get("/backup-policy", response_model=SuccessResponse[dict])
async def backup_policy(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR", "PLATFORM_SUPPORT")),
) -> SuccessResponse[dict]:
    return SuccessResponse(data={
        "enabled": settings.backup_enabled,
        "cron": settings.backup_cron,
        "retention": {
            "daily": settings.backup_keep_daily,
            "weekly": settings.backup_keep_weekly,
            "monthly": settings.backup_keep_monthly,
        },
        "encryption_enabled": bool(settings.backup_encryption_recipient),
        "destinations": {
            "local": True,
            "s3": settings.backup_upload_s3,
            "google_drive": settings.backup_google_drive_enabled,
            "dropbox": settings.backup_dropbox_enabled,
        },
    })
