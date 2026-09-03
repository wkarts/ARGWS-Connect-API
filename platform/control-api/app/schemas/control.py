from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator
from slugify import slugify

from app.schemas.common import ORMModel


class TenantCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    slug: str | None = Field(default=None, min_length=2, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    legal_document: str | None = Field(default=None, max_length=32)
    timezone: str = "America/Bahia"
    plan_code: str = "ENTERPRISE"
    admin_name: str = Field(min_length=2, max_length=160)
    admin_email: str
    admin_password: str = Field(min_length=12, max_length=512)
    initial_company_name: str = Field(min_length=2, max_length=200)
    initial_company_tax_id: str = Field(min_length=11, max_length=20)
    features: dict[str, Any] = Field(default_factory=dict)
    limits: dict[str, Any] = Field(default_factory=dict)
    partner_id: UUID | None = None
    branding_mode: Literal["INHERIT", "CUSTOM"] = "INHERIT"

    @field_validator("slug", mode="before")
    @classmethod
    def normalize_slug(cls, value: str | None) -> str | None:
        return slugify(value) if value else None


class TenantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    status: str | None = None
    plan_code: str | None = None
    timezone: str | None = Field(default=None, min_length=2, max_length=64)
    features: dict[str, Any] | None = None
    limits: dict[str, Any] | None = None
    suspended_reason: str | None = None
    partner_id: UUID | None = None
    branding_mode: Literal["INHERIT", "CUSTOM"] | None = None


class DomainCreate(BaseModel):
    hostname: str = Field(min_length=3, max_length=253)
    is_primary: bool = False
    management_mode: Literal["PLATFORM_MANAGED", "EXTERNAL_DNS"] = "EXTERNAL_DNS"
    zone_name: str | None = Field(default=None, min_length=3, max_length=253)
    dns_proxied: bool = False

    @field_validator("hostname", "zone_name")
    @classmethod
    def normalize_hostname(cls, value: str | None) -> str | None:
        return value.lower().strip().rstrip(".") if value else None


class DomainRead(ORMModel):
    id: UUID
    hostname: str
    domain_type: str
    management_mode: str = "PLATFORM_SUBDOMAIN"
    dns_provider: str = "PLATFORM"
    status: str
    is_primary: bool
    is_temporary: bool
    redirect_to_primary: bool = False
    zone_name: str | None = None
    zone_id: str | None = None
    dns_record_type: str = "CNAME"
    dns_target: str | None = None
    dns_proxied: bool = False
    nameservers: list[str] = Field(default_factory=list)
    provider_metadata: dict[str, Any] = Field(default_factory=dict)
    dns_verified_at: datetime | None
    ownership_verified_at: datetime | None = None
    last_reconciled_at: datetime | None = None
    dnssec_status: str = "UNKNOWN"
    ssl_status: str
    ssl_issued_at: datetime | None = None
    last_checked_at: datetime | None = None
    last_error: str | None


class TenantRead(ORMModel):
    id: UUID
    name: str
    slug: str
    legal_document: str | None
    status: str
    plan_code: str
    timezone: str
    partner_id: UUID | None = None
    branding_mode: str = "INHERIT"
    branding_profile_id: UUID | None = None
    features: dict[str, Any]
    limits: dict[str, Any]
    created_at: datetime
    domains: list[DomainRead] = Field(default_factory=list)


class ProvisioningJobRead(ORMModel):
    id: UUID
    tenant_id: UUID
    operation: str
    status: str
    current_step: str
    progress: int
    attempts: int
    correlation_id: str
    events: list[dict[str, Any]]
    started_at: datetime | None
    finished_at: datetime | None
    last_error: str | None
