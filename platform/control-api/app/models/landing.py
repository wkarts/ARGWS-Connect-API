from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import PlatformBase, TimestampMixin, UUIDPrimaryKeyMixin


class PlatformLandingPage(UUIDPrimaryKeyMixin, TimestampMixin, PlatformBase):
    __tablename__ = "platform_landing_pages"

    key: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True, default="PUBLIC")
    name: Mapped[str] = mapped_column(String(160), nullable=False, default="Landing principal")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    draft_document: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    draft_css: Mapped[str] = mapped_column(Text, nullable=False, default="")
    published_document: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    published_css: Mapped[str] = mapped_column(Text, nullable=False, default="")
    current_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    published_revision: Mapped[int | None] = mapped_column(Integer)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("platform_users.id", ondelete="SET NULL"))


class PlatformLandingRevision(UUIDPrimaryKeyMixin, PlatformBase):
    __tablename__ = "platform_landing_revisions"
    __table_args__ = (UniqueConstraint("landing_id", "revision", name="uq_platform_landing_revision"),)

    landing_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("platform_landing_pages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    document: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    custom_css: Mapped[str] = mapped_column(Text, nullable=False, default="")
    note: Mapped[str | None] = mapped_column(String(240))
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    actor_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("platform_users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
