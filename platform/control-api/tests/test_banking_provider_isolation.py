from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.errors import APIError
from app.models.banking_governance import PlatformBankProvider
from app.providers.banking.contracts.webhooks import BankWebhookEvent, BankWebhookRequest
from app.providers.banking.core.capabilities import BankingIntegrationMode
from app.providers.banking.core.webhook import ProviderBoundWebhookHandler
from app.providers.banking.providers.catalog import ASAAS
from app.providers.banking.registry import BankingProviderRegistry, banking_providers
from app.schemas.banking import BankConnectionCreate
from app.services.banking_binding import assert_provider_matches_bank_identity
from app.services.banking_entitlements import governance_dict


@pytest.mark.bank_contract
def test_catalog_capabilities_are_not_exposed_as_effective_driver_capabilities() -> None:
    manifest = banking_providers.manifest("BANCO_DO_BRASIL")
    row = PlatformBankProvider(
        id=uuid4(),
        code=manifest.code,
        display_name=manifest.name,
        driver_status=manifest.status.value,
        driver_installed=False,
        globally_enabled=False,
        tenant_visible=False,
        integration_modes=[],
        capabilities=[],
        environments=[],
        documentation_status="PUBLIC_VERIFIED",
        source_metadata={},
    )
    payload = governance_dict(row, manifest=manifest)
    assert payload["driver_installed"] is False
    assert payload["connection_driver_installed"] is False
    assert payload["integration_modes"] == []
    assert payload["capabilities"] == []
    assert payload["catalog_integration_modes"]
    assert payload["catalog_capabilities"]


@pytest.mark.bank_contract
def test_bank_account_cannot_be_bound_to_provider_of_another_bank() -> None:
    inter = banking_providers.manifest("INTER")
    with pytest.raises(APIError) as exc:
        assert_provider_matches_bank_identity(inter, bank_code="033", ispb="90400888")
    assert exc.value.code == "BANK_PROVIDER_ACCOUNT_MISMATCH"

    assert_provider_matches_bank_identity(inter, bank_code="077", ispb="00416968")


@pytest.mark.bank_contract
def test_bank_connection_rejects_manual_institution_and_cnab_only_provider() -> None:
    base = {
        "company_id": uuid4(),
        "bank_account_id": uuid4(),
        "environment": "PRODUCTION",
        "credentials": {},
        "settings": {},
    }
    with pytest.raises(ValidationError):
        BankConnectionCreate(
            **base,
            provider="ASAAS",
            institution_id=uuid4(),
        )

    with pytest.raises(ValidationError):
        BankConnectionCreate(
            **base,
            provider="SAFRA",
        )

    assert banking_providers.mode_available("SAFRA", BankingIntegrationMode.CNAB) is True
    assert banking_providers.mode_available("SAFRA", BankingIntegrationMode.DIRECT_API) is False


class _FakeWebhookHandler:
    provider = "ASAAS"

    def __init__(self, connection_id: str) -> None:
        self.connection_id = connection_id

    async def verify(self, *_: object, **__: object) -> tuple[bool, str | None]:
        return True, self.connection_id

    async def parse(
        self,
        request: BankWebhookRequest,
        payload: dict,
        *,
        signature_valid: bool,
    ) -> BankWebhookEvent:
        return BankWebhookEvent(
            provider_event_id="evt",
            event_type="PAYMENT_RECEIVED",
            signature_valid=signature_valid,
            payload_hash="hash",
            payload=payload,
        )

    async def process(self, *_: object, **__: object) -> None:
        return None


class _FakeWebhookSession:
    def __init__(self, connection: object) -> None:
        self.connection = connection

    async def get(self, *_: object, **__: object) -> object:
        return self.connection


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_webhook_cannot_resolve_connection_from_another_provider() -> None:
    connection_id = uuid4()
    handler = ProviderBoundWebhookHandler("ASAAS", _FakeWebhookHandler(str(connection_id)))
    session = _FakeWebhookSession(SimpleNamespace(id=connection_id, provider="INTER"))
    request = BankWebhookRequest(raw_body=b"{}", headers={})

    with pytest.raises(APIError) as exc:
        await handler.verify(session, request, {})  # type: ignore[arg-type]
    assert exc.value.code == "BANK_WEBHOOK_PROVIDER_MISMATCH"


@pytest.mark.bank_contract
def test_registry_rejects_executor_registered_under_other_bank_name() -> None:
    registry = BankingProviderRegistry()
    fake = SimpleNamespace(name="INTER")
    with pytest.raises(RuntimeError):
        registry.register("ASAAS", fake, ASAAS)
