from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.providers.banking.contracts.charges import ChargeRequestBase, ChargeResultBase


@dataclass(frozen=True, slots=True)
class BoletoRequest(ChargeRequestBase):
    hybrid_pix: bool = False


@dataclass(frozen=True, slots=True)
class BoletoResult(ChargeResultBase):
    digitable_line: str | None = None
    barcode: str | None = None
    pix_copy_paste: str | None = None
    document_url: str | None = None


class BoletoCreateProvider(Protocol):
    async def create_boleto(self, request: BoletoRequest) -> BoletoResult: ...


class BoletoQueryProvider(Protocol):
    async def get_boleto(self, provider_reference: str) -> BoletoResult: ...


class BoletoCancelProvider(Protocol):
    async def cancel_boleto(self, provider_reference: str) -> BoletoResult: ...
