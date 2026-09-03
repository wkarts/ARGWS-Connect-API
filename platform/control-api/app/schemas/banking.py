from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class BankConnectionCreate(BaseModel):
    company_id: UUID
    bank_account_id: UUID
    institution_id: UUID | None = None
    provider: str = Field(min_length=2, max_length=64)
    environment: str = "SANDBOX"
    credentials: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True

    @field_validator("provider", "environment")
    @classmethod
    def uppercase(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("institution_id")
    @classmethod
    def institution_is_provider_owned(cls, value: UUID | None) -> UUID | None:
        if value is not None:
            raise ValueError(
                "institution_id não pode ser associado manualmente à BankConnection; "
                "a instituição é determinada pelo provider e pela conta bancária."
            )
        return None

    @model_validator(mode="after")
    def direct_api_must_exist(self) -> "BankConnectionCreate":
        from app.providers.banking.core.capabilities import BankingIntegrationMode
        from app.providers.banking.registry import banking_providers

        try:
            manifest = banking_providers.manifest(self.provider)
        except Exception as exc:
            raise ValueError(f"Provider bancário desconhecido: {self.provider}") from exc
        if not banking_providers.mode_available(manifest.code, BankingIntegrationMode.DIRECT_API):
            modes = ", ".join(sorted(mode.value for mode in manifest.effective_implemented_modes())) or "nenhum"
            raise ValueError(
                f"Provider {manifest.code} não possui executor DIRECT_API; modos implementados: {modes}."
            )
        return self


class BankConnectionUpdate(BaseModel):
    environment: str | None = None
    credentials: dict[str, Any] | None = None
    settings: dict[str, Any] | None = None
    is_active: bool | None = None

    @field_validator("environment")
    @classmethod
    def uppercase_environment(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else value


class BankConnectionSyncRequest(BaseModel):
    resources: list[str] = Field(default_factory=lambda: ["STATEMENT"])
    start_date: date | None = None
    end_date: date | None = None

    @field_validator("resources")
    @classmethod
    def normalize_resources(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip().upper() for item in value if item.strip()))


class BankInstitutionSyncRequest(BaseModel):
    resource_url: str | None = None
