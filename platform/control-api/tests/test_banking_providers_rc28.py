from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
from typing import Any, AsyncIterator, Callable
from unittest.mock import AsyncMock

import pytest

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankCustomer
from app.providers.banking.core.capabilities import BankingCapability, ProviderStatus
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.providers.banrisul.provider import BanrisulBankingProvider
from app.providers.banking.providers.bradesco.provider import BradescoBankingProvider
from app.providers.banking.providers.bs2.provider import BS2BankingProvider
from app.providers.banking.providers.caixa.provider import CaixaBankingProvider
from app.providers.banking.providers.inter import InterBankingProvider
from app.providers.banking.providers.inter.client import inter_base_url
from app.providers.banking.providers.inter.constants import INTER_TOKEN_PATH
from app.providers.banking.providers.mercado_pago.provider import MercadoPagoBankingProvider
from app.providers.banking.providers.pagbank.provider import PagBankBankingProvider
from app.providers.banking.providers.picpay.provider import PicPayBankingProvider
from app.providers.banking.providers.santander.provider import SantanderBankingProvider
from app.providers.banking.providers.sicredi.provider import SicrediBankingProvider
from app.providers.banking.providers.stone.provider import StoneBankingProvider
from app.providers.banking.registry import banking_providers


RC28_EXECUTORS = {
    "BANRISUL",
    "SICREDI",
    "PICPAY",
    "MERCADO_PAGO",
    "PAGBANK",
    "STONE",
    "INTER",
    "SANTANDER",
    "BRADESCO",
    "BS2",
    "CAIXA",
    "BANCO_DO_NORDESTE",
}


class FakeResponse:
    def __init__(self, payload: Any) -> None:
        self.payload = payload
        self.status_code = 200

    def json(self) -> Any:
        return self.payload


class FakeBankClient:
    def __init__(self, handler: Callable[[str, str, dict[str, Any]], Any]) -> None:
        self.handler = handler
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    async def request(self, method: str, path: str, **kwargs: Any) -> FakeResponse:
        self.calls.append((method, path, kwargs))
        return FakeResponse(self.handler(method, path, kwargs))

    async def aclose(self) -> None:
        return None

    async def __aenter__(self) -> "FakeBankClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        return None


def charge_request(provider: str = "TEST") -> BankChargeRequest:
    return BankChargeRequest(
        internal_id="bde55efa-bce4-4571-8ad5-d4b658037a67",
        document_number="FAT-001",
        amount=Decimal("25.50"),
        due_date=date(2026, 8, 24),
        description=f"Cobrança {provider}",
        customer=BankCustomer(
            name="Cliente Teste",
            tax_id="12345678909",
            email="cliente@example.com",
            phone="5575999998888",
            address={},
        ),
        charge_type="PIX",
        agreement={"environment": "HOMOLOGATION", "credentials": {}, "settings": {}},
    )


@pytest.mark.bank_contract
def test_rc28_new_executors_are_real_and_not_promoted_beyond_evidence() -> None:
    for code in RC28_EXECUTORS:
        manifest = banking_providers.manifest(code)
        assert banking_providers.installed(code) is True
        assert manifest.implementation_available is True
        assert manifest.status is ProviderStatus.IMPLEMENTED
        assert BankingCapability.PIX_COB in manifest.capabilities
        assert manifest.status is not ProviderStatus.SANDBOX_VERIFIED
        assert manifest.status is not ProviderStatus.HOMOLOGATED
        assert manifest.status is not ProviderStatus.PRODUCTION_READY

    expected_multi = frozenset(
        {
            BankingCapability.PIX_COB,
            BankingCapability.BALANCE,
            BankingCapability.STATEMENT,
        }
    )
    assert banking_providers.manifest("STONE").capabilities == expected_multi
    # O Inter começou na rc.28 com este núcleo, mas a rc.31 o amplia com base
    # no SDK oficial. O contrato histórico deve continuar presente, não ser a
    # lista exata de capabilities para sempre.
    assert expected_multi <= banking_providers.manifest("INTER").capabilities
    for code in RC28_EXECUTORS - {"STONE", "INTER"}:
        assert banking_providers.manifest(code).capabilities == frozenset({BankingCapability.PIX_COB})


@pytest.mark.bank_contract
def test_closed_contract_banks_are_not_fake_executors() -> None:
    # Mantém a asserção histórica da rc.28 somente para bancos que seguem sem
    # executor. BB, Itaú, C6 e Mercantil saíram desta lista porque receberam
    # adapters CNAB próprios e continuam fora de DIRECT_API.
    for code in {
        "SICOOB",
        "BTG_PACTUAL",
        "BANCO_DA_AMAZONIA",
        "BRB",
        "DAYCOVAL",
    }:
        assert banking_providers.installed(code) is False
        with pytest.raises(APIError) as exc:
            banking_providers.get(code)
        assert exc.value.code == "BANKING_PROVIDER_NOT_AVAILABLE"


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_banrisul_uses_bcb_cob_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda method, path, kwargs: {
            "txid": path.rsplit("/", 1)[-1],
            "status": "ATIVA",
            "pixCopiaECola": "BANRISUL-PIX",
        }
    )

    @asynccontextmanager
    async def client(**_: Any) -> AsyncIterator[tuple[FakeBankClient, str, int]]:
        yield fake, "pix@example.com", 3600

    monkeypatch.setattr(BanrisulBankingProvider, "client", staticmethod(client))
    result = await BanrisulBankingProvider().create_charge(charge_request("BANRISUL"))
    assert result.pix_copy_paste == "BANRISUL-PIX"
    assert fake.calls[0][0] == "PUT"
    assert fake.calls[0][1].startswith("/cob/")
    assert fake.calls[0][2]["json"]["valor"]["original"] == "25.50"


@pytest.mark.bank_contract
def test_bradesco_uses_documented_homologation_contract_and_requires_production_token() -> None:
    assert BradescoBankingProvider.endpoints(
        environment="HOMOLOGATION",
        credentials={},
        settings={},
    ) == (
        "https://qrpix-h.bradesco.com.br/oauth/token",
        "https://qrpix-h.bradesco.com.br/v2",
    )
    with pytest.raises(BankProviderError) as exc:
        BradescoBankingProvider.endpoints(
            environment="PRODUCTION",
            credentials={},
            settings={},
        )
    assert exc.value.code == "BANK_INVALID_CONFIGURATION"
    assert BradescoBankingProvider.endpoints(
        environment="PRODUCTION",
        credentials={"production_token_url": "https://qrpix.bradesco.com.br/oauth/token"},
        settings={},
    ) == (
        "https://qrpix.bradesco.com.br/oauth/token",
        "https://qrpix.bradesco.com.br/v2",
    )


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_bradesco_pix_uses_cob_route(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda method, path, kwargs: {
            "txid": path.rsplit("/", 1)[-1],
            "status": "ATIVA",
            "pixCopiaECola": "BRADESCO-PIX",
        }
    )

    @asynccontextmanager
    async def client(**_: Any) -> AsyncIterator[tuple[FakeBankClient, str, int]]:
        yield fake, "pix@example.com", 3600

    monkeypatch.setattr(BradescoBankingProvider, "client", staticmethod(client))
    result = await BradescoBankingProvider().create_charge(charge_request("BRADESCO"))
    assert result.provider == "BRADESCO"
    assert result.pix_copy_paste == "BRADESCO-PIX"
    assert fake.calls[0][0] == "PUT"
    assert fake.calls[0][1].startswith("/cob/")


@pytest.mark.bank_contract
def test_bs2_requires_official_onboarding_hosts_and_production_user_agent() -> None:
    homologation = {
        "client_id": "client",
        "client_secret": "secret",
        "scope": "pix.read pix.write",
        "token_url": "https://auth.hml.bs2.com/auth/oauth/v2/token",
        "resource_base_url": "https://api.hml.bs2.com",
        "pix_key": "pix@example.com",
    }
    configuration = BS2BankingProvider._configuration(
        environment="HOMOLOGATION",
        credentials=homologation,
    )
    assert configuration[0] == "https://auth.hml.bs2.com/auth/oauth/v2/token"
    assert configuration[1] == "https://api.hml.bs2.com"
    assert configuration[4] == ("pix.read", "pix.write")

    with pytest.raises(BankProviderError) as exc:
        BS2BankingProvider._configuration(
            environment="HOMOLOGATION",
            credentials={**homologation, "token_url": "https://example.com/auth/oauth/v2/token"},
        )
    assert exc.value.code == "BANK_INVALID_CONFIGURATION"

    with pytest.raises(BankProviderError) as exc:
        BS2BankingProvider._configuration(
            environment="PRODUCTION",
            credentials=homologation,
        )
    assert exc.value.code == "BANK_INVALID_CREDENTIALS"

    production = BS2BankingProvider._configuration(
        environment="PRODUCTION",
        credentials={**homologation, "user_agent": "BS2-CLIENT-CODE"},
    )
    assert production[6] == "BS2-CLIENT-CODE"


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_bs2_pix_uses_dynamic_qr_and_txid_as_external_id(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda method, path, kwargs: {
            "id": "internal-bs2-qr-id",
            "txId": kwargs["json"]["txId"],
            "status": "ATIVA",
            "qrCode": "BS2-PIX-COPIA-E-COLA",
        }
    )

    @asynccontextmanager
    async def client(**_: Any) -> AsyncIterator[tuple[FakeBankClient, str]]:
        yield fake, "pix@example.com"

    monkeypatch.setattr(BS2BankingProvider, "_client", staticmethod(client))
    result = await BS2BankingProvider().create_charge(charge_request("BS2"))
    assert result.external_id == result.txid
    assert result.pix_copy_paste == "BS2-PIX-COPIA-E-COLA"
    method, path, kwargs = fake.calls[0]
    assert (method, path) == ("POST", "/pix/direto/forintegration/v1/qrcodes/dinamico")
    assert "idempotency_key" not in kwargs
    assert kwargs["json"]["cobranca"]["valor"]["original"] == "25.50"
    assert kwargs["json"]["cobranca"]["chave"] == "pix@example.com"


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_bs2_get_and_cancel_use_same_txid_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda method, path, kwargs: {
            "txId": path.rsplit("/", 1)[-1],
            "status": "ATIVA",
            "qrCode": "BS2-PIX",
        }
    )

    @asynccontextmanager
    async def client(**_: Any) -> AsyncIterator[tuple[FakeBankClient, str]]:
        yield fake, "pix@example.com"

    monkeypatch.setattr(BS2BankingProvider, "_client", staticmethod(client))
    provider = BS2BankingProvider()
    result = await provider.get_charge("TXID123", {"environment": "HOMOLOGATION"})
    assert result.external_id == "TXID123"
    await provider.cancel_charge("TXID123", {"environment": "HOMOLOGATION"})

    assert fake.calls[0][0:2] == (
        "GET",
        "/pix/direto/forintegration/v1/cob/TXID123",
    )
    assert fake.calls[1][0:2] == (
        "PATCH",
        "/pix/direto/forintegration/v1/cob/TXID123",
    )
    assert fake.calls[1][2]["json"] == {
        "status": "REMOVIDA_PELO_USUARIO_RECEBEDOR",
        "chave": "pix@example.com",
    }
    assert "idempotency_key" not in fake.calls[1][2]


@pytest.mark.bank_contract
def test_sicredi_never_invents_homologation_urls() -> None:
    with pytest.raises(BankProviderError) as exc:
        SicrediBankingProvider.endpoints(environment="HOMOLOGATION", credentials={}, settings={})
    assert exc.value.code == "BANK_INVALID_CONFIGURATION"
    token, api = SicrediBankingProvider.endpoints(environment="PRODUCTION", credentials={}, settings={})
    assert token == "https://api-pix.sicredi.com.br/oauth/token"
    assert api == "https://api-pix.sicredi.com.br/api/v2"


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_picpay_uses_official_charge_pix_route(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda *_: {
            "merchantChargeId": "merchant-1",
            "chargeStatus": "ACTIVE",
            "transactions": [
                {
                    "paymentType": "PIX",
                    "transactionId": "pix-1",
                    "transactionStatus": "CREATED",
                    "pix": {"qrCode": "PICPAY-PIX"},
                }
            ],
        }
    )

    async def client(**_: Any) -> tuple[FakeBankClient, int]:
        return fake, 900

    monkeypatch.setattr(PicPayBankingProvider, "_client", staticmethod(client))
    result = await PicPayBankingProvider().create_charge(charge_request("PICPAY"))
    assert result.pix_copy_paste == "PICPAY-PIX"
    assert fake.calls[0][0:2] == ("POST", "/charge/pix")


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_mercado_pago_uses_orders_and_provider_idempotency(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda *_: {
            "id": "order-1",
            "status": "action_required",
            "transactions": {
                "payments": [
                    {
                        "id": "payment-1",
                        "status": "action_required",
                        "payment_method": {
                            "qr_code": "MP-PIX",
                            "ticket_url": "https://example.test/ticket",
                        },
                    }
                ]
            },
        }
    )
    monkeypatch.setattr(MercadoPagoBankingProvider, "_client", staticmethod(lambda _: fake))
    request = charge_request("MERCADO_PAGO")
    request.agreement["credentials"]["access_token"] = "token"
    result = await MercadoPagoBankingProvider().create_charge(request)
    assert result.pix_copy_paste == "MP-PIX"
    method, path, kwargs = fake.calls[0]
    assert (method, path) == ("POST", "/v1/orders")
    assert "X-Idempotency-Key" in kwargs["headers"]
    assert kwargs["json"]["transactions"]["payments"][0]["payment_method"] == {
        "id": "pix",
        "type": "bank_transfer",
    }


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_pagbank_uses_orders_qr_code_text(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda *_: {
            "id": "ORDE_1",
            "qr_codes": [
                {
                    "id": "QR_1",
                    "text": "PAGBANK-PIX",
                    "expiration_date": "2026-08-24T12:00:00-03:00",
                    "links": [{"media": "image/png", "href": "https://example.test/qr.png"}],
                }
            ],
        }
    )
    monkeypatch.setattr(PagBankBankingProvider, "_client", staticmethod(lambda *_: fake))
    request = charge_request("PAGBANK")
    request.agreement["environment"] = "SANDBOX"
    request.agreement["credentials"]["access_token"] = "token"
    result = await PagBankBankingProvider().create_charge(request)
    assert result.external_id == "ORDE_1"
    assert result.pix_copy_paste == "PAGBANK-PIX"
    method, path, kwargs = fake.calls[0]
    assert (method, path) == ("POST", "/orders")
    assert "x-idempotency-key" in kwargs["headers"]
    assert kwargs["json"]["qr_codes"][0]["amount"]["value"] == 2550


@pytest.mark.bank_contract
def test_stone_assertion_uses_official_rs256_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def encode(payload: dict[str, Any], key: str, *, algorithm: str, headers: dict[str, str]) -> str:
        captured.update(payload=payload, key=key, algorithm=algorithm, headers=headers)
        return "assertion"

    monkeypatch.setattr("app.providers.banking.providers.stone.provider.jwt.encode", encode)
    token = StoneBankingProvider._assertion(
        audience="https://sandbox-accounts.openbank.stone.com.br/auth/realms/stone_bank",
        client_id="client",
        private_key="PRIVATE",
    )
    assert token == "assertion"
    assert captured["algorithm"] == "RS256"
    assert captured["payload"]["realm"] == "stone_bank"
    assert captured["payload"]["sub"] == "client"
    assert captured["payload"]["clientId"] == "client"
    assert captured["payload"]["iss"] == "client"
    assert captured["payload"]["exp"] - captured["payload"]["iat"] <= 900


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_stone_balance_normalizes_cents(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(lambda method, path, kwargs: {"balance": 9998})

    async def client(*_: Any, **__: Any) -> FakeBankClient:
        return fake

    monkeypatch.setattr(StoneBankingProvider, "_client", staticmethod(client))
    context = type(
        "Context",
        (),
        {
            "environment": type("Env", (), {"value": "SANDBOX"})(),
            "credentials": {"client_id": "c", "private_key": "k", "account_id": "acc", "pix_key": "pix"},
        },
    )()
    result = await StoneBankingProvider().get_balance(context)  # type: ignore[arg-type]
    assert result.available == Decimal("99.98")
    assert fake.calls[0][1] == "/api/v1/accounts/acc/balance"


@pytest.mark.bank_contract
def test_inter_rc31_uses_official_sdk_token_and_environment_contract() -> None:
    manifest = banking_providers.manifest("INTER")
    fields = {field.key for field in manifest.authentication.fields}
    assert "token_url" not in fields
    assert "oauth_client_auth" not in fields
    assert "oauth_body_mode" not in fields
    assert INTER_TOKEN_PATH == "/oauth/v2/token"
    assert inter_base_url("SANDBOX") == "https://cdpj-sandbox.partners.uatinter.co"
    assert inter_base_url("HOMOLOGATION") == "https://cdpj.partners.uatbi.com.br"
    assert inter_base_url("PRODUCTION") == "https://cdpj.partners.bancointer.com.br"


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_inter_normalizes_balance_and_official_paged_statement(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = InterBankingProvider()
    request_call = AsyncMock(
        side_effect=[
            {
                "bloqueadoCheque": 10.25,
                "disponivel": 2850.55,
                "bloqueadoJudicialmente": 20.10,
                "bloqueadoAdministrativo": 5.00,
                "limite": 510.35,
                "dataReferencia": "01/01/2024",
            },
            {
                "ultimaPagina": False,
                "totalPaginas": 2,
                "totalElementos": 2,
                "numeroDeElementos": 2,
                "transacoes": [
                    {
                        "idTransacao": "tx-credit",
                        "dataTransacao": "2026-08-20",
                        "tipoTransacao": "PIX",
                        "tipoOperacao": "C",
                        "valor": "100.50",
                        "descricao": "Recebimento Pix",
                        "numeroDocumento": "DOC1",
                        "detalhes": {
                            "txId": "abc123",
                            "endToEndId": "E123",
                            "nomePagador": "Cliente",
                            "cpfCnpjPagador": "12345678909",
                        },
                    },
                    {
                        "idTransacao": "tx-debit",
                        "dataTransacao": "2026-08-21",
                        "tipoTransacao": "PAGAMENTO",
                        "tipoOperacao": "D",
                        "valor": "50.00",
                        "descricao": "Pagamento",
                    },
                ],
            },
        ]
    )
    monkeypatch.setattr(provider, "_request", request_call)
    context = type(
        "Context",
        (),
        {
            "environment": type("Env", (), {"value": "SANDBOX"})(),
            "credentials": {},
            "settings": {"statement_page_size": 50},
            "correlation_id": "internal-only",
        },
    )()
    balance = await provider.get_balance(context)  # type: ignore[arg-type]
    assert balance.available == Decimal("2850.55")
    assert balance.blocked == Decimal("35.35")
    assert balance.credit_limit == Decimal("510.35")

    statement = await provider.get_statement(
        context,  # type: ignore[arg-type]
        type(
            "Statement",
            (),
            {"start_date": date(2026, 8, 1), "end_date": date(2026, 8, 23), "cursor": None},
        )(),
    )
    assert statement.has_more is True
    assert statement.next_cursor == "1"
    assert statement.transactions[0].amount == Decimal("100.50")
    assert statement.transactions[0].end_to_end_id == "E123"
    assert statement.transactions[1].amount == Decimal("-50.00")
    assert request_call.await_args_list[1].kwargs["params"]["pagina"] == 0
    assert request_call.await_args_list[1].kwargs["params"]["tamanhoPagina"] == 50


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_inter_pix_uses_official_resource_route(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = InterBankingProvider()
    request_call = AsyncMock(
        return_value={
            "txid": "TXID123",
            "status": "ATIVA",
            "pixCopiaECola": "INTER-PIX",
        }
    )
    monkeypatch.setattr(provider, "_request", request_call)
    request = charge_request("INTER")
    request.agreement["environment"] = "SANDBOX"
    request.agreement["credentials"]["pix_key"] = "pix@example.com"
    result = await provider.create_charge(request)
    assert result.pix_copy_paste == "INTER-PIX"
    call = request_call.await_args.kwargs
    assert call["method"] == "PUT"
    assert call["path"].startswith("/pix/v2/cob/")
    assert call["payload"]["chave"] == "pix@example.com"


@pytest.mark.bank_contract
def test_santander_uses_official_pix_hosts() -> None:
    homologation = SantanderBankingProvider.endpoints(
        environment="HOMOLOGATION", credentials={}, settings={}
    )
    production = SantanderBankingProvider.endpoints(
        environment="PRODUCTION", credentials={}, settings={}
    )
    assert homologation == (
        "https://trust-pix-h.santander.com.br/oauth/token?grant_type=client_credentials",
        "https://trust-pix-h.santander.com.br/api/v1",
    )
    assert production == (
        "https://trust-pix.santander.com.br/oauth/token?grant_type=client_credentials",
        "https://trust-pix.santander.com.br/api/v1",
    )


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_santander_pix_uses_cob_route(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda method, path, kwargs: {
            "txid": path.rsplit("/", 1)[-1],
            "status": "ATIVA",
            "location": "pix.example/qr/123",
        }
    )

    @asynccontextmanager
    async def client(**_: Any) -> AsyncIterator[tuple[FakeBankClient, str, int]]:
        yield fake, "pix@example.com", 3600

    monkeypatch.setattr(SantanderBankingProvider, "client", staticmethod(client))
    result = await SantanderBankingProvider().create_charge(charge_request("SANTANDER"))
    assert result.provider == "SANTANDER"
    assert fake.calls[0][0] == "PUT"
    assert fake.calls[0][1].startswith("/cob/")
