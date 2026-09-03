from __future__ import annotations

import asyncio
import csv
import io
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_control_roles
from app.core.config import settings
from app.core.errors import APIError
from app.db.platform import get_platform_session
from app.models.observability import PlatformRuntimeLog
from app.models.platform import PlatformAuditLog
from app.schemas.auth import AuthUser
from app.schemas.common import PaginatedResponse, PaginationMeta, SuccessResponse
from app.services.audit import platform_audit
from app.services.observability import ObservabilityService, record_runtime_log

router = APIRouter(prefix="/api/control/v1/observability", tags=["Control Plane - Observabilidade"])


class RuntimeLogIngest(BaseModel):
    source: str = Field(default="frontend", max_length=32)
    service: str = Field(default="control-web", max_length=80)
    level: str = Field(default="ERROR", max_length=16)
    event: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=32000)
    tenant_id: UUID | None = None
    request_id: str | None = Field(default=None, max_length=64)
    correlation_id: str | None = Field(default=None, max_length=64)
    method: str | None = Field(default=None, max_length=12)
    path: str | None = Field(default=None, max_length=500)
    status_code: int | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    details: dict = Field(default_factory=dict)


class PurgeRequest(BaseModel):
    retention_days: int = Field(default=30, ge=7, le=3650)


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise APIError("INVALID_DATE_FILTER", "Data de filtro inválida.", 422) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


async def _docker_containers(service: ObservabilityService) -> list[dict]:
    """Consulta o agente com timeout curto para não travar a tela operacional.

    A indisponibilidade do agente Docker é um estado degradado da observabilidade,
    não uma falha da própria API. O painel usa ``docker_available`` para sinalizar
    essa condição; não devolvemos 503 em polling normal, evitando que a Central de
    Logs produza uma tempestade de erros sobre ela mesma.
    """
    try:
        return await asyncio.wait_for(service.docker.containers(), timeout=5)
    except (TimeoutError, asyncio.TimeoutError, httpx.HTTPError):
        return []


@router.get("/logs", response_model=PaginatedResponse[dict])
async def list_runtime_logs(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=100, ge=1, le=250),
    tenant_id: UUID | None = Query(default=None),
    source: str | None = Query(default=None, max_length=32),
    service: str | None = Query(default=None, max_length=80),
    level: str | None = Query(default=None, max_length=16),
    q: str | None = Query(default=None, max_length=300),
    since: str | None = Query(default=None),
    until: str | None = Query(default=None),
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> PaginatedResponse[dict]:
    items, total = await ObservabilityService(session).list_logs(
        page=page,
        per_page=per_page,
        tenant_id=tenant_id,
        source=source,
        service=service,
        level=level,
        q=q,
        since=_parse_datetime(since),
        until=_parse_datetime(until),
    )
    return PaginatedResponse(
        data=items,
        meta=PaginationMeta(page=page, per_page=per_page, total=total, pages=(total + per_page - 1) // per_page),
    )


@router.get("/summary", response_model=SuccessResponse[dict])
async def runtime_log_summary(
    tenant_id: UUID | None = Query(default=None),
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    service = ObservabilityService(session)
    summary = await service.summary(tenant_id=tenant_id)
    since = datetime.now(UTC) - timedelta(hours=24)
    runtime_filters = [PlatformRuntimeLog.occurred_at >= since]
    audit_filters = [PlatformAuditLog.created_at >= since]
    if tenant_id:
        runtime_filters.append(PlatformRuntimeLog.tenant_id == tenant_id)
        audit_filters.append(PlatformAuditLog.tenant_id == tenant_id)

    summary["events_24h"] = int(
        await session.scalar(select(func.count()).select_from(PlatformRuntimeLog).where(*runtime_filters)) or 0
    )
    summary["warnings_24h"] = int(
        await session.scalar(
            select(func.count()).select_from(PlatformRuntimeLog).where(*runtime_filters, PlatformRuntimeLog.level == "WARNING")
        ) or 0
    )
    summary["audit_24h"] = int(
        await session.scalar(select(func.count()).select_from(PlatformAuditLog).where(*audit_filters)) or 0
    )
    last_event = await session.scalar(
        select(func.max(PlatformRuntimeLog.occurred_at)).where(
            *([PlatformRuntimeLog.tenant_id == tenant_id] if tenant_id else [])
        )
    )
    summary["last_event_at"] = last_event.isoformat() if last_event else None
    summary["retention_days"] = settings.runtime_log_retention_days

    source_rows = list((await session.execute(
        select(PlatformRuntimeLog.source, func.count())
        .where(*runtime_filters)
        .group_by(PlatformRuntimeLog.source)
        .order_by(func.count().desc())
    )).all())
    summary["sources"] = {str(source): int(count) for source, count in source_rows}

    containers = await _docker_containers(service)
    summary["containers"] = {
        "total": len(containers),
        "running": sum(1 for item in containers if str(item.get("state") or "").lower() == "running"),
        "unhealthy": sum(1 for item in containers if str(item.get("health") or "").lower() == "unhealthy"),
        "restarting": sum(1 for item in containers if str(item.get("state") or "").lower() == "restarting"),
        "exited": sum(1 for item in containers if str(item.get("state") or "").lower() == "exited"),
        "oom_killed": sum(1 for item in containers if bool(item.get("oom_killed"))),
    }
    summary["docker_available"] = bool(containers)
    return SuccessResponse(data=summary)


@router.get("/services", response_model=SuccessResponse[list[dict]])
async def list_runtime_services(
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    return SuccessResponse(data=await _docker_containers(ObservabilityService(session)))


@router.get("/services/{container_id}/logs", response_model=SuccessResponse[dict])
async def runtime_service_logs(
    container_id: str,
    tail: int = Query(default=500, ge=1, le=5000),
    since: int | None = Query(default=None, ge=0),
    q: str | None = Query(default=None, max_length=300),
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    try:
        data = await ObservabilityService(session).docker.logs(container_id, tail=tail, since=since, search=q)
        return SuccessResponse(data=data)
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code if exc.response.status_code in {401, 404, 422} else 502
        raise APIError("DOCKER_LOG_READ_FAILED", "Não foi possível ler os logs do serviço selecionado.", status) from exc
    except httpx.HTTPError as exc:
        raise APIError("DOCKER_LOG_AGENT_UNAVAILABLE", "O agente de logs da stack está indisponível.", 503) from exc


@router.post("/logs/ingest", response_model=SuccessResponse[dict])
async def ingest_control_log(
    payload: RuntimeLogIngest,
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    item = await record_runtime_log(
        session,
        source=payload.source,
        service=payload.service,
        level=payload.level,
        event=payload.event,
        message=payload.message,
        tenant_id=payload.tenant_id,
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


@router.get("/export")
async def export_complete_diagnostics(
    tenant_id: UUID | None = Query(default=None),
    user: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> Response:
    payload, filename = await ObservabilityService(session).export_bundle(tenant_id=tenant_id)
    await platform_audit(
        session,
        action="observability.diagnostics_exported",
        entity_type="DiagnosticsBundle",
        entity_id=str(tenant_id) if tenant_id else "platform",
        actor_id=user.id,
        tenant_id=str(tenant_id) if tenant_id else None,
        after={"filename": filename, "bytes": len(payload)},
        context={"origin": "control-plane"},
    )
    await session.commit()
    return Response(
        content=payload,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/logs.csv")
async def export_runtime_logs_csv(
    tenant_id: UUID | None = Query(default=None),
    level: str | None = Query(default=None),
    source: str | None = Query(default=None),
    service: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=300),
    _: AuthUser = Depends(require_control_roles("PLATFORM_ADMIN", "PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> Response:
    items, _ = await ObservabilityService(session).list_logs(
        page=1,
        per_page=250,
        tenant_id=tenant_id,
        level=level,
        source=source,
        service=service,
        q=q,
    )
    target = io.StringIO()
    writer = csv.writer(target, delimiter=";")
    writer.writerow([
        "data", "nivel", "origem", "servico", "evento", "mensagem",
        "cliente", "request_id", "status_http", "duracao_ms",
    ])
    for item in items:
        writer.writerow([
            item.get("occurred_at"), item.get("level"), item.get("source"), item.get("service"),
            item.get("event"), item.get("message"), item.get("tenant_id"), item.get("request_id"),
            item.get("status_code"), item.get("duration_ms"),
        ])
    filename = f"multitenant-app-runtime-logs-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.csv"
    return Response(
        content="\ufeff" + target.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.post("/purge", response_model=SuccessResponse[dict])
async def purge_runtime_logs(
    payload: PurgeRequest,
    user: AuthUser = Depends(require_control_roles("PLATFORM_SUPERADMIN")),
    session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    removed = await ObservabilityService(session).purge(payload.retention_days)
    await record_runtime_log(
        session,
        source="control",
        service="observability",
        level="WARNING",
        event="runtime_logs_purged",
        message=f"Logs operacionais anteriores à retenção de {payload.retention_days} dias foram removidos.",
        actor_id=user.id,
        details={"removed": removed, "retention_days": payload.retention_days},
    )
    await platform_audit(
        session,
        action="observability.runtime_logs_purged",
        entity_type="RuntimeLogs",
        entity_id="platform",
        actor_id=user.id,
        after={"removed": removed, "retention_days": payload.retention_days},
        context={"audit_preserved": True},
    )
    await session.commit()
    return SuccessResponse(
        data={"removed": removed, "retention_days": payload.retention_days, "audit_preserved": True}
    )
