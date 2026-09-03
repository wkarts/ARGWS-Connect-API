from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.providers.banking.core.capabilities import BankingEnvironment
from app.providers.banking.core.manifest import ProviderManifest


@dataclass(frozen=True, slots=True)
class BankingProviderContext:
    tenant_id: UUID
    company_id: UUID
    bank_account_id: UUID
    connection_id: UUID
    provider_code: str
    environment: BankingEnvironment
    manifest: ProviderManifest
    credentials: dict[str, Any] = field(default_factory=dict, repr=False)
    settings: dict[str, Any] = field(default_factory=dict)
    correlation_id: str | None = None
