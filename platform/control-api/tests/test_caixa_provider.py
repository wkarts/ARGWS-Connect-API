from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
from typing import Any, AsyncIterator, Callable

import pytest

from app.providers.banking.base import BankChargeRequest, BankCustomer
from app.providers.banking.core.capabilities import BankingCapability, ProviderStatus
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.providers.caixa.provider import CaixaBankingProvider
from app.providers.banking.registry import banking_providers


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


def charge_request() -> BankChargeRequest:
    return BankChargeRequest(
        internal_id="bde55efa-bce4-4571-8ad5-d4b658037a67",
        document_number="FAT-CAIXA-001",
        amount=Decimal("25.50"),
        due_date=date(2026, 8, 24),
        description="Cobrança CAIXA",
        customer=BankCustomer(
            name="Cliente Teste",
            tax_id="12345678909",
            email="cliente@example.com",
            phone="5575999998888",
            address={},
        ),
        charge_type="PIX",
        agreement={"environment": "SANDBOX", "credentials": {}, "settings": {}},
    )


@pytest.mark.bank_contract
def test_caixa_is_real_executor_without_maturity_promotion() -> None:
    manifest = banking_providers.manifest("CAIXA")
    assert banking_providers.installed("CAIXA") is True
    assert manifest.implementation_available is True
    assert manifest.status is ProviderStatus.IMPLEMENTED
    assert manifest.capabilities == frozenset({BankingCapability.PIX_COB})
    assert manifest.status is not ProviderStatus.SANDBOX_VERIFIED
    assert manifest.status is not ProviderStatus.HOMOLOGATED
    assert manifest.status is not ProviderStatus.PRODUCTION_READY


@pytest.mark.bank_contract
def test_caixa_configuration_uses_official_resource_bases_and_rejects_foreign_token_host() -> None:
    credentials = {
        "client_id": "client",
        "client_secret": "secret",
        "token_url": "https://oauth.caixa.gov.br/token",
        "scope": "cob.read cob.write",
        "oauth_client_auth": "BODY",
        "oauth_body_mode": "FORM",
        "pix_key": "pix@example.com",
        "user_agent": "Connect-API-Platform-Cliente-123",
    }
    sandbox = CaixaBankingProvider._configuration(environment="SANDBOX", credentials=credentials)
    assert sandbox[1] == "https://api.caixa.gov.br:8443/sandbox/servicos-bancarios/requisicoes/pix-automatico"
    assert sandbox[4] == ("cob.read", "cob.write")
    assert sandbox[9] == "cliente_id"
    assert sandbox[10] == "cliente_secret"

    production = CaixaBankingProvider._configuration(environment="PRODUCTION", credentials=credentials)
    assert production[1] == "https://api.caixa.gov.br:8443/servicos-bancarios/requisicoes/pix-automatico"

    with pytest.raises(BankProviderError) as exc:
        CaixaBankingProvider._configuration(
            environment="SANDBOX",
            credentials={**credentials, "token_url": "https://example.com/oauth/token"},
        )
    assert exc.value.code == "BANK_INVALID_CONFIGURATION"


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_caixa_pix_cob_uses_documented_put_get_patch_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda method, path, kwargs: {
            "txid": path.rsplit("/", 1)[-1],
            "status": "ATIVA",
            "pixCopiaECola": "CAIXA-PIX",
        }
    )

    @asynccontextmanager
    async def client(**_: Any) -> AsyncIterator[tuple[FakeBankClient, str]]:
        yield fake, "pix@example.com"

    monkeypatch.setattr(CaixaBankingProvider, "_client", staticmethod(client))
    request = charge_request()
    request.agreement["settings"]["pix_expiration_seconds"] = 900

    provider = CaixaBankingProvider()
    created = await provider.create_charge(request)
    assert created.provider == "CAIXA"
    assert created.pix_copy_paste == "CAIXA-PIX"
    method, path, kwargs = fake.calls[0]
    assert method == "PUT"
    assert path.startswith("/cob/")
    assert kwargs["json"]["chave"] == "pix@example.com"
    assert kwargs["json"]["valor"]["original"] == "25.50"
    assert kwargs["json"]["calendario"]["expiracao"] == 900

    txid = created.external_id
    fetched = await provider.get_charge(txid, {"environment": "SANDBOX"})
    assert fetched.external_id == txid
    await provider.cancel_charge(txid, {"environment": "SANDBOX"})

    assert fake.calls[1][0:2] == ("GET", f"/cob/{txid}")
    assert fake.calls[2][0:2] == ("PATCH", f"/cob/{txid}")
    assert fake.calls[2][2]["json"] == {"status": "REMOVIDA_PELO_USUARIO_RECEBEDOR"}


@pytest.mark.bank_contract
def test_caixa_amount_contract_remains_decimal() -> None:
    assert charge_request().amount == Decimal("25.50")
