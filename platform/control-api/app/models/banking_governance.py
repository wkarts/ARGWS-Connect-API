from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import PlatformBase, TimestampMixin, UUIDPrimaryKeyMixin


class PlatformBankProvider(UUIDPrimaryKeyMixin, TimestampMixin, PlatformBase):
    """Estado operacional/comercial global de um provider bancário.

    Os campos técnicos são sincronizados a partir do registry/manifests. Flags
    comerciais são administradas pelo Control Plane e não carregam segredos de
    tenant/empresa.
    """

    __tablename__ = "platform_bank_providers"
    __table_args__ = (
        Index("ix_platform_bank_providers_enabled", "globally_enabled", "tenant_visible"),
        Index("ix_platform_bank_providers_status", "driver_status", "driver_installed"),
    )

    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    institution_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("bank_institutions.id", ondelete="SET NULL"), nullable=True
    )
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    driver_version: Mapped[str | None] = mapped_column(String(64))
    driver_status: Mapped[str] = mapped_column(String(40), nullable=False, default="CATALOG_ONLY")
    driver_installed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    globally_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tenant_visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    integration_modes: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    capabilities: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    environments: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)

    documentation_status: Mapped[str] = mapped_column(String(40), nullable=False, default="UNKNOWN")
    documentation_version: Mapped[str | None] = mapped_column(String(120))
    documentation_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    documentation_hash: Mapped[str | None] = mapped_column(String(64))

    sandbox_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    homologation_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    production_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_health_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_health_check_status: Mapped[str | None] = mapped_column(String(40))

    source_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)


class PlanBankProviderPolicy(UUIDPrimaryKeyMixin, TimestampMixin, PlatformBase):
    __tablename__ = "plan_bank_provider_policies"
    __table_args__ = (
        UniqueConstraint("plan_id", name="uq_plan_bank_provider_policies_plan"),
        Index("ix_plan_bank_provider_policies_mode", "mode"),
    )

    plan_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("platform_plans.id", ondelete="CASCADE"), nullable=False
    )
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="ALL")


class PlanBankProviderRule(UUIDPrimaryKeyMixin, TimestampMixin, PlatformBase):
    __tablename__ = "plan_bank_provider_rules"
    __table_args__ = (
        UniqueConstraint("policy_id", "provider_code", name="uq_plan_bank_provider_rule"),
        Index("ix_plan_bank_provider_rules_provider", "provider_code", "allowed"),
    )

    policy_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("plan_bank_provider_policies.id", ondelete="CASCADE"), nullable=False
    )
    provider_code: Mapped[str] = mapped_column(
        String(64), ForeignKey("platform_bank_providers.code", ondelete="CASCADE"), nullable=False
    )
    allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class TenantBankProviderPolicy(UUIDPrimaryKeyMixin, TimestampMixin, PlatformBase):
    __tablename__ = "tenant_bank_provider_policies"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_tenant_bank_provider_policies_tenant"),
        Index("ix_tenant_bank_provider_policies_mode", "mode"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="INHERIT")


class TenantBankProviderOverride(UUIDPrimaryKeyMixin, TimestampMixin, PlatformBase):
    __tablename__ = "tenant_bank_provider_overrides"
    __table_args__ = (
        UniqueConstraint("tenant_id", "provider_code", name="uq_tenant_bank_provider_override"),
        Index("ix_tenant_bank_provider_overrides_provider", "provider_code", "action"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    provider_code: Mapped[str] = mapped_column(
        String(64), ForeignKey("platform_bank_providers.code", ondelete="CASCADE"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(16), nullable=False, default="INHERIT")
