from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, SecretStr, field_validator


class PlanInput(BaseModel):
    code: str = Field(min_length=2, max_length=50, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    monthly_price: Decimal = Field(default=Decimal("0"), ge=0)
    annual_price: Decimal = Field(default=Decimal("0"), ge=0)
    features: dict[str, bool] = Field(default_factory=dict)
    limits: dict[str, int | float | str | None] = Field(default_factory=dict)
    sort_order: int = 0
    is_public: bool = True
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()


class PlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = None
    monthly_price: Decimal | None = Field(default=None, ge=0)
    annual_price: Decimal | None = Field(default=None, ge=0)
    features: dict[str, bool] | None = None
    limits: dict[str, int | float | str | None] | None = None
    sort_order: int | None = None
    is_public: bool | None = None
    is_active: bool | None = None


class PlatformUserInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    email: EmailStr
    password: SecretStr = Field(min_length=12, max_length=512)
    role: str = "PLATFORM_ADMIN"
    is_active: bool = True


class PlatformUserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    role: str | None = None
    is_active: bool | None = None


class PlatformPasswordInput(BaseModel):
    password: SecretStr = Field(min_length=12, max_length=512)


class PlatformSettingInput(BaseModel):
    category: str = Field(default="GENERAL", min_length=2, max_length=64)
    value: dict[str, Any] = Field(default_factory=dict)
    description: str | None = None
    is_secret: bool = False


class PlatformIntegrationInput(BaseModel):
    is_enabled: bool = True
    public_config: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, Any] = Field(default_factory=dict)


class TenantLifecycleInput(BaseModel):
    action: str
    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("action")
    @classmethod
    def normalize_action(cls, value: str) -> str:
        action = value.strip().upper()
        allowed = {"ACTIVATE", "SUSPEND", "BLOCK", "CANCEL", "ARCHIVE", "REACTIVATE"}
        if action not in allowed:
            raise ValueError(f"Ação inválida. Permitidas: {', '.join(sorted(allowed))}")
        return action


class DomainUpdateInput(BaseModel):
    is_primary: bool | None = None
    redirect_to_primary: bool | None = None
    status: str | None = None


class SupportSessionInput(BaseModel):
    tenant_id: UUID
    reason: str = Field(min_length=5, max_length=2000)
    duration_minutes: int = Field(default=30, ge=5, le=240)


class RestoreRequestInput(BaseModel):
    backup_run_id: UUID | None = None
    source_path: str | None = None
    scope: str = "FULL"
    tenant_id: UUID | None = None
    validate_only: bool = False


class PlatformApiKeyInput(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    permissions: list[str] = Field(default_factory=list)
    allowed_ips: list[str] = Field(default_factory=list)
    expires_at: datetime | None = None
