from __future__ import annotations

import io
import json
import os
import re
import zipfile
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.observability import PlatformRuntimeLog
from app.models.platform import PlatformAuditLog, ProvisioningJob, Tenant

_REDACT_KEY = re.compile(
    r"password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|credential|field_encryption",
    re.IGNORECASE,
)
_BEARER = re.compile(r"(Bearer\s+)[A-Za-z0-9._~+\-/=]+", re.IGNORECASE)


def redact(value: Any, *, depth: int = 0) -> Any:
    if depth > 6:
        return "[MAX_DEPTH]"
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in list(value.items())[:120]:
            result[str(key)] = "[REDACTED]" if _REDACT_KEY.search(str(key)) else redact(item, depth=depth + 1)
        return result
    if isinstance(value, (list, tuple, set)):
        return [redact(item, depth=depth + 1) for item in list(value)[:120]]
    if isinstance(value, str):
        return _BEARER.sub(r"\1[REDACTED]", value)[:32000]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:32000]


def _uuid(value: str | UUID | None) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def runtime_log_dict(item: PlatformRuntimeLog) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "tenant_id": str(item.tenant_id) if item.tenant_id else None,
        "actor_id": str(item.actor_id) if item.actor_id else None,
        "source": item.source,
        "service": item.service,
        "level": item.level,
        "event": item.event,
        "message": item.message,
        "request_id": item.request_id,
        "correlation_id": item.correlation_id,
        "method": item.method,
        "path": item.path,
        "status_code": item.status_code,
        "duration_ms": item.duration_ms,
        "details": redact(item.details or {}),
        "occurred_at": item.occurred_at.isoformat(),
    }


async def record_runtime_log(
    session: AsyncSession,
    *,
    source: str,
    service: str,
    level: str,
    event: str,
    message: str,
    tenant_id: str | UUID | None = None,
    actor_id: str | UUID | None = None,
    request_id: str | None = None,
    correlation_id: str | None = None,
    method: str | None = None,
    path: str | None = None,
    status_code: int | None = None,
    duration_ms: int | None = None,
    details: dict[str, Any] | None = None,
    commit: bool = True,
) -> PlatformRuntimeLog:
    item = PlatformRuntimeLog(
        tenant_id=_uuid(tenant_id),
        actor_id=_uuid(actor_id),
        source=source.strip().lower()[:32] or "backend",
        service=service.strip()[:80] or "api",
        level=level.strip().upper()[:16] or "INFO",
        event=event.strip()[:160] or "event",
        message=str(message)[:32000],
        request_id=(request_id or "")[:64] or None,
        correlation_id=(correlation_id or "")[:64] or None,
        method=(method or "")[:12] or None,
        path=(path or "")[:500] or None,
        status_code=status_code,
        duration_ms=duration_ms,
        details=redact(details or {}),
        occurred_at=datetime.now(UTC),
    )
    session.add(item)
    if commit:
        await session.commit()
        await session.refresh(item)
    return item


class DockerLogAgentClient:
    def __init__(self) -> None:
        self.url = os.getenv("LOG_AGENT_URL", "http://connect-log-agent:8091").rstrip("/")
        self.token = os.getenv("INTERNAL_SERVICES_PASSWORD", "")

    def _headers(self) -> dict[str, str]:
        return {"X-Internal-Token": self.token}

    async def health(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{self.url}/health", headers=self._headers())
            response.raise_for_status()
            return response.json()

    async def containers(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(f"{self.url}/containers", headers=self._headers())
            response.raise_for_status()
            data = response.json()
        return data if isinstance(data, list) else []

    async def logs(
        self,
        container: str,
        *,
        tail: int = 500,
        since: int | None = None,
        search: str | None = None,
        all_lines: bool = False,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"tail": tail, "all_lines": str(all_lines).lower()}
        if since is not None:
            params["since"] = since
        if search:
            params["search"] = search
        async with httpx.AsyncClient(timeout=100 if all_lines else 35) as client:
            response = await client.get(
                f"{self.url}/logs/{container}", headers=self._headers(), params=params
            )
            response.raise_for_status()
            data = response.json()
        return data if isinstance(data, dict) else {"lines": []}


class ObservabilityService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.docker = DockerLogAgentClient()

    async def list_logs(
        self,
        *,
        page: int = 1,
        per_page: int = 100,
        tenant_id: UUID | None = None,
        source: str | None = None,
        service: str | None = None,
        level: str | None = None,
        q: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        filters = []
        if tenant_id:
            filters.append(PlatformRuntimeLog.tenant_id == tenant_id)
        if source:
            filters.append(PlatformRuntimeLog.source == source.lower())
        if service:
            filters.append(PlatformRuntimeLog.service == service)
        if level:
            filters.append(PlatformRuntimeLog.level == level.upper())
        if q:
            term = f"%{q}%"
            filters.append(
                or_(
                    PlatformRuntimeLog.message.ilike(term),
                    PlatformRuntimeLog.event.ilike(term),
                    PlatformRuntimeLog.path.ilike(term),
                    PlatformRuntimeLog.request_id.ilike(term),
                    PlatformRuntimeLog.correlation_id.ilike(term),
                )
            )
        if since:
            filters.append(PlatformRuntimeLog.occurred_at >= since)
        if until:
            filters.append(PlatformRuntimeLog.occurred_at <= until)
        total = int(await self.session.scalar(select(func.count()).select_from(PlatformRuntimeLog).where(*filters)) or 0)
        items = list(
            (await self.session.scalars(
                select(PlatformRuntimeLog)
                .where(*filters)
                .order_by(PlatformRuntimeLog.occurred_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )).all()
        )
        return [runtime_log_dict(item) for item in items], total

    async def summary(self, tenant_id: UUID | None = None) -> dict[str, Any]:
        since = datetime.now(UTC) - timedelta(hours=24)
        filters = [PlatformRuntimeLog.occurred_at >= since]
        if tenant_id:
            filters.append(PlatformRuntimeLog.tenant_id == tenant_id)
        level_rows = list((await self.session.execute(
            select(PlatformRuntimeLog.level, func.count()).where(*filters).group_by(PlatformRuntimeLog.level)
        )).all())
        service_rows = list((await self.session.execute(
            select(PlatformRuntimeLog.service, func.count())
            .where(*filters)
            .group_by(PlatformRuntimeLog.service)
            .order_by(func.count().desc())
            .limit(20)
        )).all())
        errors = int(await self.session.scalar(
            select(func.count()).select_from(PlatformRuntimeLog).where(*filters, PlatformRuntimeLog.level.in_(["ERROR", "CRITICAL"]))
        ) or 0)
        slow = int(await self.session.scalar(
            select(func.count()).select_from(PlatformRuntimeLog).where(*filters, PlatformRuntimeLog.event == "slow_request")
        ) or 0)
        return {
            "period_hours": 24,
            "levels": {str(level): int(count) for level, count in level_rows},
            "services": {str(service): int(count) for service, count in service_rows},
            "errors": errors,
            "slow_requests": slow,
        }

    async def purge(self, retention_days: int) -> int:
        cutoff = datetime.now(UTC) - timedelta(days=max(1, retention_days))
        result = await self.session.execute(delete(PlatformRuntimeLog).where(PlatformRuntimeLog.occurred_at < cutoff))
        await self.session.commit()
        return int(result.rowcount or 0)

    async def export_bundle(self, tenant_id: UUID | None = None) -> tuple[bytes, str]:
        errors: list[dict[str, Any]] = []
        output = io.BytesIO()
        timestamp = datetime.now(UTC)
        tenant = await self.session.get(Tenant, tenant_id) if tenant_id else None
        max_bytes = max(10, int(os.getenv("OBSERVABILITY_BUNDLE_MAX_MB", "100"))) * 1024 * 1024

        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            manifest = {
                "generated_at": timestamp.isoformat(),
                "scope": "tenant" if tenant_id else "platform",
                "tenant_id": str(tenant_id) if tenant_id else None,
                "tenant_name": tenant.name if tenant else None,
                "redacted": True,
                "includes": ["runtime logs", "platform audit", "provisioning events", "container inventory", "Docker stdout/stderr"],
                "max_bundle_mb": max_bytes // (1024 * 1024),
            }
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

            log_filters = [PlatformRuntimeLog.tenant_id == tenant_id] if tenant_id else []
            runtime_items = list((await self.session.scalars(
                select(PlatformRuntimeLog).where(*log_filters).order_by(PlatformRuntimeLog.occurred_at)
            )).all())
            archive.writestr(
                "platform/runtime-logs.jsonl",
                "\n".join(json.dumps(runtime_log_dict(item), ensure_ascii=False) for item in runtime_items),
            )

            audit_filters = [PlatformAuditLog.tenant_id == tenant_id] if tenant_id else []
            audit_items = list((await self.session.scalars(
                select(PlatformAuditLog).where(*audit_filters).order_by(PlatformAuditLog.created_at)
            )).all())
            archive.writestr(
                "platform/audit.jsonl",
                "\n".join(
                    json.dumps(redact({
                        "id": str(item.id),
                        "actor_id": str(item.actor_id) if item.actor_id else None,
                        "tenant_id": str(item.tenant_id) if item.tenant_id else None,
                        "action": item.action,
                        "entity_type": item.entity_type,
                        "entity_id": item.entity_id,
                        "before": item.before,
                        "after": item.after,
                        "context": item.context,
                        "correlation_id": item.correlation_id,
                        "created_at": item.created_at.isoformat(),
                    }), ensure_ascii=False) for item in audit_items
                ),
            )

            job_filters = [ProvisioningJob.tenant_id == tenant_id] if tenant_id else []
            jobs = list((await self.session.scalars(
                select(ProvisioningJob).where(*job_filters).order_by(ProvisioningJob.created_at)
            )).all())
            archive.writestr(
                "platform/provisioning.jsonl",
                "\n".join(
                    json.dumps(redact({
                        "id": str(item.id),
                        "tenant_id": str(item.tenant_id),
                        "operation": item.operation,
                        "status": item.status,
                        "step": item.current_step,
                        "progress": item.progress,
                        "attempts": item.attempts,
                        "events": item.events,
                        "last_error": item.last_error,
                        "created_at": item.created_at.isoformat(),
                    }), ensure_ascii=False) for item in jobs
                ),
            )

            try:
                containers = await self.docker.containers()
                archive.writestr("docker/containers.json", json.dumps(redact(containers), ensure_ascii=False, indent=2))
                for container in containers:
                    if output.tell() >= max_bytes:
                        errors.append({"source": "bundle", "error": "SIZE_LIMIT_REACHED"})
                        break
                    name = str(container.get("name") or container.get("id") or "container")
                    try:
                        payload = await self.docker.logs(name, all_lines=True)
                        lines = [str(redact(line)) for line in payload.get("lines") or []]
                        content = "\n".join(lines).encode("utf-8", errors="replace")
                        remaining = max(max_bytes - output.tell(), 0)
                        if len(content) > remaining:
                            content = content[-remaining:] if remaining else b""
                            errors.append({"source": f"docker:{name}", "error": "TRUNCATED_BY_BUNDLE_LIMIT"})
                        archive.writestr(f"docker/logs/{re.sub(r'[^A-Za-z0-9_.-]+', '-', name)}.log", content)
                    except Exception as exc:  # noqa: BLE001
                        errors.append({"source": f"docker:{name}", "error": type(exc).__name__})
            except Exception as exc:  # noqa: BLE001
                errors.append({"source": "docker", "error": type(exc).__name__})

            if errors:
                archive.writestr("errors.json", json.dumps(errors, ensure_ascii=False, indent=2))

        scope = f"tenant-{tenant_id}" if tenant_id else "platform"
        filename = f"multitenant-app-diagnostics-{scope}-{timestamp.strftime('%Y%m%d-%H%M%S')}.zip"
        return output.getvalue(), filename
