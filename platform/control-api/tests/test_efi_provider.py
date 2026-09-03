from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
from typing import Any, AsyncIterator

import pytest

from app.core.errors import APIError
from app.providers.banking.base import BankChargeRequest, BankCustomer
from app.providers.banking.core.auth import OAuth2ClientCredentials
from app.providers.banking.providers.efi.provider import EfiBankingProvider


class FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict[str, Any]:
        return self._payload


class FakeBankClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    async def request(self, method: str, path: str, **kwargs: Any) -> FakeResponse:
        self.calls.append((method, path, kwargs))
        return FakeResponse({
            "txid": path.rsplit("/", 1)[-1],
            "status": "ATIVA",
            "pixCopiaECola": "000201TEST",
            "calendario": {"expiracao": 3600},
            "valor": {"original": "25.50"},
            "loc": {"id": 123},
        })


def request_fixture() -> BankChargeRequest:
    return BankChargeRequest(
        internal_id="d5943ef8-b9b6-4fa2-b13e-1195bc154c82",
        document_number="FAT-001",
        amount=Decimal("25.50"),
        due_date=date(2026, 8, 24),
        description="Serviço de teste",
        customer=BankCustomer(
            name="Cliente Teste",
            tax_id="12345678909",
            email="cliente@example.com",
            phone=None,
            address={},
        ),
        charge_type="PIX",
        agreement={
            "environment": "HOMOLOGATION",
            "credentials": {
                "client_id": "client",
                "client_secret": "secret",
                "certificate": "CERTIFICATE",
                "private_key": "PRIVATE KEY",
                "pix_key": "pix@example.com",
            },
            "settings": {"pix_expiration_seconds": 3600},
        },
    )


@pytest.mark.bank_contract
def test_efi_txid_is_deterministic_and_bacen_compatible_length() -> None:
    first = EfiBankingProvider._txid("internal-reference-with-symbols-123")
    second = EfiBankingProvider._txid("internal-reference-with-symbols-123")
    assert first == second
    assert first.isalnum()
    assert 26 <= len(first) <= 35


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_efi_create_charge_uses_documented_pix_cob_route(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeBankClient()

    @asynccontextmanager
    async def fake_client(*_: Any, **__: Any) -> AsyncIterator[tuple[FakeBankClient, str, int]]:
        yield fake, "pix@example.com", 3600

    monkeypatch.setattr(EfiBankingProvider, "_client", fake_client)
    result = await EfiBankingProvider().create_charge(request_fixture())

    assert result.provider == "EFI"
    assert result.status == "ATIVA"
    assert result.pix_copy_paste == "000201TEST"
    assert len(fake.calls) == 1
    method, path, kwargs = fake.calls[0]
    assert method == "PUT"
    assert path.startswith("/v2/cob/")
    assert kwargs["json"]["valor"]["original"] == "25.50"
    assert kwargs["json"]["chave"] == "pix@example.com"
    assert kwargs["json"]["devedor"]["cpf"] == "12345678909"


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_efi_rejects_non_pix_charge_without_calling_provider() -> None:
    request = request_fixture()
    request = BankChargeRequest(
        internal_id=request.internal_id,
        document_number=request.document_number,
        amount=request.amount,
        due_date=request.due_date,
        description=request.description,
        customer=request.customer,
        charge_type="BOLETO",
        agreement=request.agreement,
    )
    with pytest.raises(APIError) as exc:
        await EfiBankingProvider().create_charge(request)
    assert exc.value.code == "BANK_CAPABILITY_NOT_SUPPORTED"


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_oauth_client_credentials_supports_json_body_without_changing_default(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class FakeHttpClient:
        def __init__(self, **kwargs: Any) -> None:
            captured["client_kwargs"] = kwargs

        async def __aenter__(self) -> "FakeHttpClient":
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def post(self, url: str, **kwargs: Any) -> FakeResponse:
            captured["url"] = url
            captured["post_kwargs"] = kwargs
            return FakeResponse({"access_token": "token-value", "expires_in": 300, "token_type": "Bearer"})

    monkeypatch.setattr("app.providers.banking.core.auth.httpx.AsyncClient", FakeHttpClient)

    auth = OAuth2ClientCredentials(
        provider="EFI",
        environment="HOMOLOGATION",
        token_url="https://pix-h.api.efipay.com.br/oauth/token",
        allowed_hosts={"pix-h.api.efipay.com.br"},
        client_id="client",
        client_secret="secret",
        redis=None,
        client_auth="BASIC",
        body_mode="JSON",
        cert=("cert.pem", "key.pem"),
    )
    material = await auth.material()

    assert material.headers == {"Authorization": "Bearer token-value"}
    assert captured["post_kwargs"]["json"] == {"grant_type": "client_credentials"}
    assert "data" not in captured["post_kwargs"]
    assert captured["client_kwargs"]["cert"] == ("cert.pem", "key.pem")
