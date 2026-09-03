from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import PlatformBase, UUIDPrimaryKeyMixin


class PlatformRuntimeLog(UUIDPrimaryKeyMixin, PlatformBase):
    __tablename__ = "platform_runtime_logs"
    __table_args__ = (
        Index("ix_runtime_logs_occurred_level", "occurred_at", "level"),
        Index("ix_runtime_logs_tenant_occurred", "tenant_id", "occurred_at"),
        Index("ix_runtime_logs_service_occurred", "service", "occurred_at"),
        Index("ix_runtime_logs_request_id", "request_id"),
    )

    tenant_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True, index=True)
    actor_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="backend", index=True)
    service: Mapped[str] = mapped_column(String(80), nullable=False, default="api", index=True)
    level: Mapped[str] = mapped_column(String(16), nullable=False, default="INFO", index=True)
    event: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    method: Mapped[str | None] = mapped_column(String(12), nullable=True)
    path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC), index=True
    )
