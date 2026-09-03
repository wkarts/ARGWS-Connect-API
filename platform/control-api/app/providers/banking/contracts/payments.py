from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class BankPaymentRequest:
    idempotency_key: str
    amount: Decimal
    scheduled_date: date
    payment_type: str
    digitable_line: str | None = None
    barcode: str | None = None
    tax_code: str | None = None
    document_number: str | None = None
    description: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class BankPaymentResult:
    provider_reference: str
    provider_status: str
    amount: Decimal
    scheduled_date: date | None = None
    bank_reference: str | None = None
    raw_response: dict[str, Any] = field(default_factory=dict)


class BankPaymentProvider(Protocol):
    async def create_payment(self, request: BankPaymentRequest) -> BankPaymentResult: ...

    async def get_payment(self, provider_reference: str) -> BankPaymentResult: ...
