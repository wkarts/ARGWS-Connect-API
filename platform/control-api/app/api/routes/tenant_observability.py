from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_connect_api_tser, get_tenant_context_dep
from app.core.tenant_context import TenantContext
from app.db.platform import get_platform_session
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.observability import record_runtime_log

router = APIRouter(prefix="/api/v1/observability", tags=["Tenant - Observabilidade"])


class TenantRuntimeLogIngest(BaseModel):
    source: str = Field(default="frontend", max_length=32)
    service: str = Field(default="tenant-web", max_length=80)
    level: str = Field(default="ERROR", max_length=16)
    event: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=32000)
    request_id: str | None = Field(default=None, max_length=64)
    correlation_id: str | None = Field(default=None, max_length=64)
    method: str | None = Field(default=None, max_length=12)
    path: str | None = Field(default=None, max_length=500)
    status_code: int | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    details: dict = Field(default_factory=dict)


@router.post("/logs/ingest", response_model=SuccessResponse[dict])
async def ingest_tenant_log(
    payload: TenantRuntimeLogIngest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(current_connect_api_tser),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    item = await record_runtime_log(
        session,
        source=payload.source,
        service=payload.service,
        level=payload.level,
        event=payload.event,
        message=payload.message,
        tenant_id=context.tenant_id,
        actor_id=user.id,
        request_id=payload.request_id,
        correlation_id=payload.correlation_id,
        method=payload.method,
        path=payload.path,
        status_code=payload.status_code,
        duration_ms=payload.duration_ms,
        details=payload.details,
    )
    return SuccessResponse(data={"id": str(item.id), "accepted": True})
