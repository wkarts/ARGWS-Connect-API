from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class BankTransactionResult:
    provider_transaction_id: str
    amount: Decimal
    transaction_date: date
    transaction_type: str
    description: str
    posted_at: datetime | None = None
    external_id: str | None = None
    document_number: str | None = None
    end_to_end_id: str | None = None
    txid: str | None = None
    bank_reference: str | None = None
    payer_name: str | None = None
    payer_tax_id: str | None = None
    provider_status: str | None = None
    provider_metadata: dict[str, Any] = field(default_factory=dict)
    raw_response: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class StatementRequest:
    start_date: date
    end_date: date
    cursor: str | None = None


@dataclass(frozen=True, slots=True)
class StatementResult:
    transactions: tuple[BankTransactionResult, ...]
    next_cursor: str | None = None
    has_more: bool = False
    provider_reference: str | None = None
    provider_metadata: dict[str, Any] = field(default_factory=dict)
    raw_response: dict[str, Any] = field(default_factory=dict)


class StatementProvider(Protocol):
    async def get_statement(self, request: StatementRequest) -> StatementResult: ...
