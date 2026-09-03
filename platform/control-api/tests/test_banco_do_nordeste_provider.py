from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Callable

import pytest

from app.providers.banking.base import BankChargeRequest, BankCustomer
from app.providers.banking.core.capabilities import BankingCapability, ProviderStatus
from app.providers.banking.core.errors import BankProviderError
from app.providers.banking.providers.banco_do_nordeste.provider import BancoDoNordesteBankingProvider
from app.providers.banking.registry import banking_providers


class FakeResponse:
    def __init__(self, payload: Any) -> None:
        self.payload = payload

    def json(self) -> Any:
        return self.payload


class FakeBankClient:
    def __init__(self, handler: Callable[[str, str, dict[str, Any]], Any]) -> None:
        self.handler = handler
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.closed = False

    async def request(self, method: str, path: str, **kwargs: Any) -> FakeResponse:
        self.calls.append((method, path, kwargs))
        return FakeResponse(self.handler(method, path, kwargs))

    async def aclose(self) -> None:
        self.closed = True


def request_fixture() -> BankChargeRequest:
    return BankChargeRequest(
        internal_id="7a8026ad-b766-463a-8025-8c593525f830",
        document_number="BNB-001",
        amount=Decimal("80.75"),
        due_date=date(2026, 8, 25),
        description="Cobrança BNB",
        customer=BankCustomer(
            name="Cliente BNB",
            tax_id="12345678909",
            email="cliente@example.com",
            phone=None,
            address={},
        ),
        charge_type="PIX",
        agreement={
            "environment": "HOMOLOGATION",
            "credentials": {
                "api_key": "key-value",
                "api_secret": "secret-value",
                "api_key_header": "X-BNB-Key",
                "api_secret_header": "X-BNB-Secret",
                "pix_key": "pix@example.com",
            },
            "settings": {"pix_expiration_seconds": 1800},
        },
    )


@pytest.mark.bank_contract
def test_bnb_is_installed_without_homologation_promotion() -> None:
    manifest = banking_providers.manifest("BANCO_DO_NORDESTE")
    assert banking_providers.installed("BANCO_DO_NORDESTE") is True
    assert manifest.implementation_available is True
    assert manifest.status is ProviderStatus.IMPLEMENTED
    assert manifest.capabilities == frozenset({BankingCapability.PIX_COB})
    assert manifest.status is not ProviderStatus.HOMOLOGATED
    assert manifest.status is not ProviderStatus.PRODUCTION_READY


@pytest.mark.bank_contract
def test_bnb_uses_official_resource_bases_and_does_not_invent_header_names() -> None:
    credentials = request_fixture().agreement["credentials"]
    homologation = BancoDoNordesteBankingProvider._configuration(
        environment="HOMOLOGATION",
        credentials=credentials,
    )
    assert homologation[0] == "https://api-h.bnb.gov.br/pix/v1"
    assert homologation[3:] == ("X-BNB-Key", "X-BNB-Secret")

    production = BancoDoNordesteBankingProvider._configuration(
        environment="PRODUCTION",
        credentials=credentials,
    )
    assert production[0] == "https://api.bnb.gov.br/pix/v1"

    with pytest.raises(BankProviderError) as exc:
        BancoDoNordesteBankingProvider._configuration(
            environment="HOMOLOGATION",
            credentials={**credentials, "api_key_header": "header\r\nInjected"},
        )
    assert exc.value.code == "BANK_INVALID_CONFIGURATION"


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_bnb_pix_cob_uses_official_put_get_patch_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient(
        lambda method, path, kwargs: {
            "txid": path.rsplit("/", 1)[-1],
            "status": "ATIVA",
            "pixCopiaECola": "BNB-PIX",
        }
    )

    def client(**_: Any) -> tuple[FakeBankClient, str]:
        return fake, "pix@example.com"

    monkeypatch.setattr(BancoDoNordesteBankingProvider, "_client", staticmethod(client))
    provider = BancoDoNordesteBankingProvider()
    created = await provider.create_charge(request_fixture())
    assert created.pix_copy_paste == "BNB-PIX"
    assert fake.calls[0][0] == "PUT"
    assert fake.calls[0][1].startswith("/cob/")
    assert fake.calls[0][2]["json"]["chave"] == "pix@example.com"
    assert fake.calls[0][2]["json"]["calendario"]["expiracao"] == 1800
    assert fake.closed is True

    fake.closed = False
    fetched = await provider.get_charge(created.external_id, request_fixture().agreement)
    assert fetched.external_id == created.external_id
    assert fake.calls[1][0:2] == ("GET", f"/cob/{created.external_id}")
    assert fake.closed is True

    fake.closed = False
    await provider.cancel_charge(created.external_id, request_fixture().agreement)
    assert fake.calls[2][0:2] == ("PATCH", f"/cob/{created.external_id}")
    assert fake.calls[2][2]["json"] == {"status": "REMOVIDA_PELO_USUARIO_RECEBEDOR"}
    assert fake.closed is True
