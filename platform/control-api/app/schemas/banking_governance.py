from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class BankProviderGovernanceUpdate(BaseModel):
    globally_enabled: bool | None = None
    tenant_visible: bool | None = None
    notes: str | None = Field(default=None, max_length=4000)


class BankProviderGovernanceBulkUpdate(BaseModel):
    providers: list[str] = Field(min_length=1)
    globally_enabled: bool | None = None
    tenant_visible: bool | None = None

    @field_validator("providers")
    @classmethod
    def normalize_providers(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip().upper() for item in value if item.strip()))


class PlanBankProviderPolicyInput(BaseModel):
    mode: Literal["ALL", "SELECTED", "NONE"] = "ALL"
    providers: list[str] = Field(default_factory=list)

    @field_validator("providers")
    @classmethod
    def normalize_providers(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip().upper() for item in value if item.strip()))


class TenantBankProviderOverrideInput(BaseModel):
    provider: str = Field(min_length=2, max_length=64)
    action: Literal["ALLOW", "DENY", "INHERIT"]

    @field_validator("provider")
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        return value.strip().upper()


class TenantBankProviderPolicyInput(BaseModel):
    mode: Literal["INHERIT", "CUSTOM"] = "INHERIT"
    overrides: list[TenantBankProviderOverrideInput] = Field(default_factory=list)


class ProviderEntitlementQuery(BaseModel):
    tenant_id: UUID
    provider: str

    @field_validator("provider")
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        return value.strip().upper()
