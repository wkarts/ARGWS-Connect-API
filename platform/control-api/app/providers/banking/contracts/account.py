from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class BankAccountReference:
    bank_code: str | None
    ispb: str | None
    branch: str | None
    account: str | None
    account_digit: str | None = None
    account_type: str | None = None


@dataclass(frozen=True, slots=True)
class BankParty:
    name: str | None = None
    tax_id: str | None = None
    account: BankAccountReference | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AccountInfoResult:
    account: BankAccountReference
    holder: BankParty | None = None
    provider_reference: str | None = None
    provider_status: str | None = None
    provider_metadata: dict[str, Any] = field(default_factory=dict)
    raw_response: dict[str, Any] = field(default_factory=dict)


class AccountInfoProvider(Protocol):
    async def account_info(self) -> AccountInfoResult: ...
