from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from app.providers.banking.contracts.account import BankParty


@dataclass(frozen=True, slots=True)
class ChargeParty:
    name: str
    tax_id: str | None = None
    email: str | None = None
    phone: str | None = None
    address: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ChargeRequestBase:
    idempotency_key: str
    document_number: str
    amount: Decimal
    due_date: date | None
    description: str
    payer: ChargeParty
    beneficiary: BankParty | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ChargeResultBase:
    provider_reference: str
    provider_status: str
    amount: Decimal | None = None
    txid: str | None = None
    our_number: str | None = None
    document_number: str | None = None
    end_to_end_id: str | None = None
    provider_metadata: dict[str, Any] = field(default_factory=dict)
    raw_response: dict[str, Any] = field(default_factory=dict)
