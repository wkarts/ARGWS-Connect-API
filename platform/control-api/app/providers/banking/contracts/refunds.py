from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class RefundRequest:
    idempotency_key: str
    provider_payment_reference: str
    amount: Decimal
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class RefundResult:
    provider_reference: str
    provider_status: str
    amount: Decimal
    raw_response: dict[str, Any] = field(default_factory=dict)


class RefundProvider(Protocol):
    async def create_refund(self, request: RefundRequest) -> RefundResult: ...
