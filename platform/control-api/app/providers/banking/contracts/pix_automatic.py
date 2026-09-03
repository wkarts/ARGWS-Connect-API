from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Protocol

from app.providers.banking.contracts.charges import ChargeParty


@dataclass(frozen=True, slots=True)
class PixAutomaticAuthorizationRequest:
    idempotency_key: str
    contract_reference: str
    payer: ChargeParty
    frequency: str
    start_date: date
    description: str
    finish_date: date | None = None
    fixed_amount: Decimal | None = None
    minimum_amount: Decimal | None = None
    immediate_amount: Decimal | None = None
    immediate_due_date: date | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PixAutomaticAuthorizationResult:
    provider_reference: str
    provider_status: str
    authorization_url: str | None = None
    pix_copy_paste: str | None = None
    raw_response: dict[str, Any] = field(default_factory=dict)


class PixAutomaticProvider(Protocol):
    async def create_pix_automatic_authorization(
        self, request: PixAutomaticAuthorizationRequest
    ) -> PixAutomaticAuthorizationResult: ...

    async def get_pix_automatic_authorization(
        self, provider_reference: str
    ) -> PixAutomaticAuthorizationResult: ...

    async def cancel_pix_automatic_authorization(
        self, provider_reference: str
    ) -> PixAutomaticAuthorizationResult: ...
