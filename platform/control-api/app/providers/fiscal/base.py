from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class FiscalCustomer:
    name: str
    tax_id: str | None
    email: str | None
    address: dict[str, Any]


@dataclass(frozen=True, slots=True)
class FiscalIssuer:
    legal_name: str
    tax_id: str
    municipal_registration: str | None
    municipality_code: str | None
    address: dict[str, Any]


@dataclass(frozen=True, slots=True)
class FiscalIssueRequest:
    internal_id: str
    issuer: FiscalIssuer
    customer: FiscalCustomer
    service_description: str
    service_code: str | None
    amount: Decimal
    competence: str
    environment: str
    settings: dict[str, Any]
    credentials: dict[str, Any]


@dataclass(frozen=True, slots=True)
class FiscalIssueResult:
    provider: str
    external_id: str
    number: str
    verification_code: str
    status: str
    issued_at: datetime
    xml: bytes
    pdf: bytes
    raw: dict[str, Any]


class FiscalProvider(Protocol):
    name: str

    async def issue(self, request: FiscalIssueRequest) -> FiscalIssueResult: ...

    async def cancel(self, external_id: str, reason: str, credentials: dict[str, Any]) -> dict[str, Any]: ...
