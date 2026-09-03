from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Protocol

from app.providers.banking.contracts.account import BankParty


@dataclass(frozen=True, slots=True)
class BankTransferRequest:
    idempotency_key: str
    amount: Decimal
    scheduled_date: date
    transfer_type: str
    destination: BankParty
    description: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class BankTransferResult:
    provider_reference: str
    provider_status: str
    amount: Decimal
    bank_reference: str | None = None
    end_to_end_id: str | None = None
    raw_response: dict[str, Any] = field(default_factory=dict)


class TransferProvider(Protocol):
    async def create_transfer(self, request: BankTransferRequest) -> BankTransferResult: ...
