from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class BankCustomer:
    name: str
    tax_id: str | None
    email: str | None
    phone: str | None
    address: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class BankChargeRequest:
    internal_id: str
    document_number: str
    amount: Decimal
    due_date: date
    description: str
    customer: BankCustomer
    charge_type: str
    agreement: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class BankChargeResult:
    provider: str
    external_id: str
    status: str
    our_number: str | None = None
    txid: str | None = None
    digitable_line: str | None = None
    barcode: str | None = None
    pix_copy_paste: str | None = None
    document_url: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PixAutomaticAuthorizationRequest:
    internal_contract_id: str
    customer: BankCustomer
    frequency: str
    start_date: date
    finish_date: date | None
    fixed_amount: Decimal | None
    min_limit_value: Decimal | None
    description: str
    immediate_amount: Decimal
    immediate_due_date: date
    payment_creation_mode: str = "MANUAL"
    retry_policy: str = "NOT_ALLOWED"
    agreement: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PixAutomaticAuthorizationResult:
    provider: str
    external_id: str
    status: str
    authorization_url: str | None = None
    qr_copy_paste: str | None = None
    qr_encoded_image: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class BankingProvider(Protocol):
    name: str

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult: ...

    async def cancel_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> None: ...

    async def get_charge(self, external_id: str, agreement: dict[str, Any] | None = None) -> BankChargeResult: ...

    async def create_pix_automatic_authorization(
        self, request: PixAutomaticAuthorizationRequest
    ) -> PixAutomaticAuthorizationResult: ...

    async def get_pix_automatic_authorization(
        self, external_id: str, agreement: dict[str, Any] | None = None
    ) -> PixAutomaticAuthorizationResult: ...

    async def cancel_pix_automatic_authorization(
        self, external_id: str, agreement: dict[str, Any] | None = None
    ) -> None: ...
