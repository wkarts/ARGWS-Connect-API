from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Protocol

from app.providers.banking.contracts.charges import ChargeParty, ChargeRequestBase, ChargeResultBase


@dataclass(frozen=True, slots=True)
class PixChargeRequest(ChargeRequestBase):
    pix_key: str = ""
    expiration_seconds: int = 3600
    txid: str | None = None


@dataclass(frozen=True, slots=True)
class PixDueDateChargeRequest(ChargeRequestBase):
    pix_key: str = ""
    txid: str = ""


@dataclass(frozen=True, slots=True)
class PixChargeResult(ChargeResultBase):
    pix_copy_paste: str | None = None
    location: str | None = None


@dataclass(frozen=True, slots=True)
class PixReceivedResult:
    end_to_end_id: str
    txid: str | None
    amount: Decimal
    received_at: datetime
    payer: ChargeParty | None = None
    provider_reference: str | None = None
    raw_response: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PixPaymentRequest:
    idempotency_key: str
    amount: Decimal
    scheduled_date: date
    description: str
    pix_key: str | None = None
    copy_paste: str | None = None
    destination_ispb: str | None = None
    destination_branch: str | None = None
    destination_account: str | None = None
    destination_account_type: str | None = None
    destination_name: str | None = None
    destination_tax_id: str | None = None


@dataclass(frozen=True, slots=True)
class PixPaymentResult:
    provider_reference: str
    provider_status: str
    amount: Decimal
    end_to_end_id: str | None = None
    raw_response: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PixRefundRequest:
    idempotency_key: str
    end_to_end_id: str
    amount: Decimal
    refund_id: str


@dataclass(frozen=True, slots=True)
class PixRefundResult:
    provider_reference: str
    provider_status: str
    amount: Decimal
    end_to_end_id: str | None = None
    raw_response: dict[str, Any] = field(default_factory=dict)


class PixCobProvider(Protocol):
    async def create_pix_cob(self, request: PixChargeRequest) -> PixChargeResult: ...


class PixCobVProvider(Protocol):
    async def create_pix_cobv(self, request: PixDueDateChargeRequest) -> PixChargeResult: ...


class PixPaymentProvider(Protocol):
    async def pay_pix(self, request: PixPaymentRequest) -> PixPaymentResult: ...


class PixRefundProvider(Protocol):
    async def refund_pix(self, request: PixRefundRequest) -> PixRefundResult: ...
