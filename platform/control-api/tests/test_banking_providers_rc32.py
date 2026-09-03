from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
from typing import Any, AsyncIterator, Callable
from uuid import uuid4

import pytest

from app.providers.banking.base import BankChargeRequest, BankCustomer
from app.providers.banking.contracts.statements import StatementRequest
from app.providers.banking.core.capabilities import BankingEnvironment, BankingIntegrationMode
from app.providers.banking.core.context import BankingProviderContext
from app.providers.banking.providers.asaas.provider import AsaasBankingProvider
from app.providers.banking.providers.banco_do_brasil.provider import BancoDoBrasilBankingProvider
from app.providers.banking.providers.efi.provider import EfiBankingProvider
from app.providers.banking.registry import banking_providers


class FakeResponse:
    def __init__(self, payload: Any) -> None:
        self.payload = payload
        self.status_code = 200
        self.content = b"{}"
        self.is_success = True

    def json(self) -> Any:
        return self.payload


class FakeBankClient:
    def __init__(self, handler: Callable[[str, str, dict[str, Any]], Any]) -> None:
        self.handler = handler
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    async def request(self, method: str, path: str, **kwargs: Any) -> FakeResponse:
        self.calls.append((method, path, kwargs))
        return FakeResponse(self.handler(method, path, kwargs))

    async def get(self, path: str, **kwargs: Any) -> FakeResponse:
        return await self.request("GET", path, **kwargs)


def provider_context(code: str, environment: BankingEnvironment) -> BankingProviderContext:
    return BankingProviderContext(
        tenant_id=uuid4(),
        company_id=uuid4(),
        bank_account_id=uuid4(),
        connection_id=uuid4(),
        provider_code=code,
        environment=environment,
        manifest=banking_providers.manifest(code),
        credentials={},
        settings={},
        correlation_id="rc32-test",
    )


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_efi_balance_maps_official_gn_balance_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda method, path, kwargs: {
            "saldo": "1580.44",
            "bloqueios": {"judicial": "100.00", "med": "20.00", "total": "120.00"},
        }
    )

    @asynccontextmanager
    async def client(**_: Any) -> AsyncIterator[tuple[FakeBankClient, str, int]]:
        yield fake, "", 3600

    monkeypatch.setattr(EfiBankingProvider, "_client", staticmethod(client))
    result = await EfiBankingProvider().get_balance(provider_context("EFI", BankingEnvironment.HOMOLOGATION))

    assert result.available == Decimal("1580.44")
    assert result.blocked == Decimal("120.00")
    assert fake.calls == [("GET", "/v2/gn/saldo", {"params": {"bloqueios": "true"}})]


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_asaas_balance_and_statement_are_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(method: str, path: str, kwargs: dict[str, Any]) -> Any:
        if path == "/finance/balance":
            return {"balance": 900.55}
        if path == "/financialTransactions":
            return {
                "object": "list",
                "hasMore": True,
                "totalCount": 2,
                "limit": 100,
                "offset": 0,
                "data": [
                    {
                        "id": "fin_1",
                        "value": 125.20,
                        "balance": 900.55,
                        "type": "PAYMENT_RECEIVED",
                        "date": "2026-08-25",
                        "description": "Cobrança recebida",
                        "paymentId": "pay_1",
                    }
                ],
            }
        raise AssertionError(path)

    fake = FakeBankClient(handler)

    @asynccontextmanager
    async def client(_: Any) -> AsyncIterator[FakeBankClient]:
        yield fake

    monkeypatch.setattr(AsaasBankingProvider, "_client", staticmethod(client))
    context = provider_context("ASAAS", BankingEnvironment.SANDBOX)
    provider = AsaasBankingProvider()

    balance = await provider.get_balance(context)
    statement = await provider.get_statement(
        context,
        StatementRequest(start_date=date(2026, 8, 1), end_date=date(2026, 8, 25)),
    )

    assert balance.available == Decimal("900.55")
    assert len(statement.transactions) == 1
    assert statement.transactions[0].provider_transaction_id == "fin_1"
    assert statement.transactions[0].amount == Decimal("125.2")
    assert statement.transactions[0].bank_reference == "fin_1"
    assert statement.next_cursor == "1"
    assert statement.has_more is True


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_banco_do_brasil_registers_hybrid_boleto_using_openapi_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda method, path, kwargs: {
            "numero": kwargs["json"]["numeroTituloCliente"],
            "linhaDigitavel": "00190.00009 00000.000000 00000.000000 1 99990000012550",
            "codigoBarraNumerico": "00191999900000125500000000000000000000000000",
            "qrCode": {"txId": "BBTX123", "emv": "000201BBPIX"},
            "urlImagemBoleto": "https://bb.example/boleto",
        }
    )

    @asynccontextmanager
    async def client(**_: Any) -> AsyncIterator[tuple[FakeBankClient, str, str]]:
        yield fake, "a" * 31, "1234567"

    monkeypatch.setattr(BancoDoBrasilBankingProvider, "_client", staticmethod(client))
    request = BankChargeRequest(
        internal_id="4a7c2520-6d22-48aa-8746-7caf5cc77c2e",
        document_number="123",
        amount=Decimal("125.50"),
        due_date=date(2026, 9, 10),
        description="Mensalidade Connect API",
        customer=BankCustomer(
            name="Cliente Teste",
            tax_id="12345678909",
            email="cliente@example.com",
            phone="5575999999999",
            address={
                "street": "Rua Teste, 10",
                "district": "Centro",
                "city": "Santo Antônio de Jesus",
                "state": "BA",
                "postal_code": "44571-000",
            },
        ),
        charge_type="BOLETO_PIX",
        agreement={
            "environment": "SANDBOX",
            "credentials": {
                "client_id": "client",
                "client_secret": "secret",
                "developer_application_key": "a" * 31,
                "numero_convenio": "1234567",
            },
            "settings": {},
        },
    )

    result = await BancoDoBrasilBankingProvider().create_charge(request)
    method, path, kwargs = fake.calls[0]
    payload = kwargs["json"]

    assert (method, path) == ("POST", "/boletos")
    assert kwargs["params"]["gw-dev-app-key"] == "a" * 31
    assert payload["numeroConvenio"] == 1234567
    assert payload["numeroTituloCliente"] == "00012345670000000123"
    assert payload["indicadorPix"] == "S"
    assert payload["pagador"]["tipoInscricao"] == 1
    assert payload["pagador"]["cep"] == 44571000
    assert result.external_id == payload["numeroTituloCliente"]
    assert result.txid == "BBTX123"
    assert result.pix_copy_paste == "000201BBPIX"


@pytest.mark.bank_contract
def test_banco_do_brasil_rc32_has_direct_and_cnab_modes_without_fake_pix_cob() -> None:
    manifest = banking_providers.manifest("BANCO_DO_BRASIL")
    assert manifest.effective_implemented_modes() == frozenset(
        {BankingIntegrationMode.DIRECT_API, BankingIntegrationMode.CNAB}
    )
    assert banking_providers.installed("BANCO_DO_BRASIL") is True
    assert manifest.metadata["api_contract_version"] == "3.2.2"
    assert "PIX_COB" not in {capability.value for capability in manifest.capabilities}
