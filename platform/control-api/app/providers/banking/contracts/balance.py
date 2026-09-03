from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class BalanceResult:
    available: Decimal
    current: Decimal | None = None
    blocked: Decimal | None = None
    credit_limit: Decimal | None = None
    currency: str = "BRL"
    reference_at: datetime | None = None
    provider_reference: str | None = None
    provider_status: str | None = None
    provider_metadata: dict[str, Any] = field(default_factory=dict)
    raw_response: dict[str, Any] = field(default_factory=dict)


class BalanceProvider(Protocol):
    async def get_balance(self) -> BalanceResult: ...
