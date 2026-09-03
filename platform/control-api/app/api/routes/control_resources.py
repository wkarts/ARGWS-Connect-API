from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_control_roles
from app.db.platform import get_platform_session
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import platform_audit
from app.services.resource_admin import (
    GrafanaAdminService,
    PlatformResourceCatalog,
    PostgresResourceAdmin,
    PrometheusAdminService,
    S3AdminService,
)

router = APIRouter(prefix="/api/control/v1/resources", tags=["Control Plane - Recursos"])


class ConfirmationInput(BaseModel):
    confirm: str = Field(min_length=1, max_length=1024)


class BucketCreateInput(BaseModel):
    name: str = Field(min_length=3, max_length=63, pattern=r"^[a-z0-9][a-z0-9.-]+[a-z0-9]$")


class BucketVersioningInput(BaseModel):
    enabled: bool


class PostgresMaintenanceInput(BaseModel):
    operation: Literal["ANALYZE", "VACUUM_ANALYZE", "REINDEX_DATABASE"]
    confirm: str = Field(min_length=1, max_length=63)


class PrometheusQueryInput(BaseModel):
    expression: str = Field(min_length=1, max_length=10000)
    at: str | None = Field(default=None, max_length=64)


class GrafanaDashboardInput(BaseModel):
    dashboard: dict[str, Any]
    folderId: int | None = None
    folderUid: str | None = Field(default=None, max_length=160)
    message: str | None = Field(default=None, max_length=500)
    overwrite: bool = True


class GrafanaFolderInput(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    uid: str | None = Field(default=None, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")


async def _audit(
    session: AsyncSession,
    user: AuthUser,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    after: dict[str, Any],
) -> None:
    await platform_audit(
        session,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=user.id,
        after=after,
        context={"origin": "control-plane-resource-admin"},
    )
    await session.commit()


@router.get("/catalog", response_model=SuccessResponse[list[dict]])
async def resource_catalog(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[list[dict]]:
    return SuccessResponse(data=PlatformResourceCatalog.entries())


@router.get("/s3/buckets", response_model=SuccessResponse[list[dict]])
async def list_s3_buckets(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[list[dict]]:
    return SuccessResponse(data=await S3AdminService.build().list_buckets())


@router.get("/s3/buckets/{bucket}", response_model=SuccessResponse[dict])
async def s3_bucket_detail(
    bucket: str,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await S3AdminService.build().bucket_detail(bucket))


@router.post("/s3/buckets", response_model=SuccessResponse[dict], status_code=201)
async def create_s3_bucket(
    payload: BucketCreateInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await S3AdminService.build().create_bucket(payload.name)
    await _audit(
        session,
        user,
        action="resource.s3.bucket_created",
        entity_type="S3Bucket",
        entity_id=payload.name,
        after={"bucket": payload.name},
    )
    return SuccessResponse(data=result)


@router.delete("/s3/buckets/{bucket}", response_model=SuccessResponse[dict])
async def delete_s3_bucket(
    bucket: str,
    payload: ConfirmationInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await S3AdminService.build().delete_bucket(bucket, confirm=payload.confirm)
    await _audit(
        session,
        user,
        action="resource.s3.bucket_deleted",
        entity_type="S3Bucket",
        entity_id=bucket,
        after={"bucket": bucket, "deleted": True},
    )
    return SuccessResponse(data=result)


@router.patch("/s3/buckets/{bucket}/versioning", response_model=SuccessResponse[dict])
async def update_s3_versioning(
    bucket: str,
    payload: BucketVersioningInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await S3AdminService.build().set_versioning(bucket, payload.enabled)
    await _audit(
        session,
        user,
        action="resource.s3.versioning_updated",
        entity_type="S3Bucket",
        entity_id=bucket,
        after=result,
    )
    return SuccessResponse(data=result)


@router.get("/s3/buckets/{bucket}/objects", response_model=SuccessResponse[dict])
async def list_s3_objects(
    bucket: str,
    prefix: str = Query(default="", max_length=1024),
    continuation_token: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=100, ge=1, le=1000),
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[dict]:
    return SuccessResponse(
        data=await S3AdminService.build().list_objects(
            bucket,
            prefix=prefix,
            continuation_token=continuation_token,
            limit=limit,
        )
    )


@router.delete("/s3/buckets/{bucket}/objects/{key:path}", response_model=SuccessResponse[dict])
async def delete_s3_object(
    bucket: str,
    key: str,
    payload: ConfirmationInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await S3AdminService.build().delete_object(bucket, key, confirm=payload.confirm)
    await _audit(
        session,
        user,
        action="resource.s3.object_deleted",
        entity_type="S3Object",
        entity_id=f"{bucket}/{key}",
        after={"bucket": bucket, "key": key, "deleted": True},
    )
    return SuccessResponse(data=result)


@router.get("/postgres", response_model=SuccessResponse[dict])
async def postgres_overview(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await PostgresResourceAdmin().overview())


@router.get("/postgres/sessions", response_model=SuccessResponse[list[dict]])
async def postgres_sessions(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[list[dict]]:
    return SuccessResponse(data=await PostgresResourceAdmin().sessions())


@router.get("/postgres/locks", response_model=SuccessResponse[list[dict]])
async def postgres_locks(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[list[dict]]:
    return SuccessResponse(data=await PostgresResourceAdmin().locks())


@router.post("/postgres/sessions/{pid}/terminate", response_model=SuccessResponse[dict])
async def terminate_postgres_session(
    pid: int,
    payload: ConfirmationInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await PostgresResourceAdmin().terminate_session(pid, confirm=payload.confirm)
    await _audit(
        session,
        user,
        action="resource.postgres.session_terminated",
        entity_type="PostgresSession",
        entity_id=str(pid),
        after=result,
    )
    return SuccessResponse(data=result)


@router.post("/postgres/databases/{database}/maintenance", response_model=SuccessResponse[dict])
async def postgres_maintenance(
    database: str,
    payload: PostgresMaintenanceInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await PostgresResourceAdmin().maintenance(
        database,
        payload.operation,
        confirm=payload.confirm,
    )
    await _audit(
        session,
        user,
        action="resource.postgres.maintenance_executed",
        entity_type="PostgresDatabase",
        entity_id=database,
        after=result,
    )
    return SuccessResponse(data=result)


@router.get("/prometheus", response_model=SuccessResponse[dict])
async def prometheus_overview(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await PrometheusAdminService().overview())


@router.post("/prometheus/query", response_model=SuccessResponse[dict])
async def prometheus_query(
    payload: PrometheusQueryInput,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await PrometheusAdminService().query(payload.expression, at=payload.at))


@router.post("/prometheus/reload", response_model=SuccessResponse[dict])
async def prometheus_reload(
    payload: ConfirmationInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await PrometheusAdminService().reload(confirm=payload.confirm)
    await _audit(
        session,
        user,
        action="resource.prometheus.reloaded",
        entity_type="Prometheus",
        entity_id="platform",
        after=result,
    )
    return SuccessResponse(data=result)


@router.get("/grafana", response_model=SuccessResponse[dict])
async def grafana_overview(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await GrafanaAdminService().overview())


@router.get("/grafana/dashboards/{uid}", response_model=SuccessResponse[dict])
async def grafana_dashboard(
    uid: str,
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_AUDITOR")),
) -> SuccessResponse[dict]:
    return SuccessResponse(data=await GrafanaAdminService().dashboard(uid))


@router.put("/grafana/dashboards", response_model=SuccessResponse[dict])
async def save_grafana_dashboard(
    payload: GrafanaDashboardInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    body = payload.model_dump(exclude_none=True)
    result = await GrafanaAdminService().save_dashboard(body)
    uid = str(payload.dashboard.get("uid") or result.get("uid") or "new")
    await _audit(
        session,
        user,
        action="resource.grafana.dashboard_saved",
        entity_type="GrafanaDashboard",
        entity_id=uid,
        after={"uid": uid, "title": payload.dashboard.get("title"), "overwrite": payload.overwrite},
    )
    return SuccessResponse(data=result)


@router.delete("/grafana/dashboards/{uid}", response_model=SuccessResponse[dict])
async def delete_grafana_dashboard(
    uid: str,
    payload: ConfirmationInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await GrafanaAdminService().delete_dashboard(uid, confirm=payload.confirm)
    await _audit(
        session,
        user,
        action="resource.grafana.dashboard_deleted",
        entity_type="GrafanaDashboard",
        entity_id=uid,
        after={"uid": uid, "deleted": True},
    )
    return SuccessResponse(data=result)


@router.post("/grafana/folders", response_model=SuccessResponse[dict], status_code=201)
async def create_grafana_folder(
    payload: GrafanaFolderInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await GrafanaAdminService().create_folder(title=payload.title, uid=payload.uid)
    uid = str(result.get("uid") or payload.uid or payload.title)
    await _audit(
        session,
        user,
        action="resource.grafana.folder_created",
        entity_type="GrafanaFolder",
        entity_id=uid,
        after={"uid": uid, "title": payload.title},
    )
    return SuccessResponse(data=result)


@router.delete("/grafana/folders/{uid}", response_model=SuccessResponse[dict])
async def delete_grafana_folder(
    uid: str,
    payload: ConfirmationInput,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    result = await GrafanaAdminService().delete_folder(uid, confirm=payload.confirm)
    await _audit(
        session,
        user,
        action="resource.grafana.folder_deleted",
        entity_type="GrafanaFolder",
        entity_id=uid,
        after={"uid": uid, "deleted": True},
    )
    return SuccessResponse(data=result)
