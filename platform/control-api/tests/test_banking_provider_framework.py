from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from pydantic import ValidationError

from app.core.errors import APIError
from app.providers.banking.core.capabilities import (
    BankingCapability,
    BankingEnvironment,
    BankingIntegrationMode,
    ProviderStatus,
)
from app.providers.banking.core.http_client import BankHTTPClient
from app.providers.banking.core.normalization import money, sanitize_mapping
from app.providers.banking.core.webhook import banking_webhooks
from app.providers.banking.providers.catalog import ALL_PROVIDER_MANIFESTS
from app.providers.banking.registry import banking_providers
from app.schemas.banking_governance import BankProviderGovernanceBulkUpdate
from app.services.bank_institutions import BankInstitutionCatalogService
from app.services.banking_entitlements import ProviderEntitlementDecision, evaluate_provider_entitlement
from app.services.reconciliation_engine import ReconciliationCandidate, ReconciliationDecision, ReconciliationEngine

MANDATORY = {
    "SANDBOX", "ASAAS", "BANCO_DO_BRASIL", "ITAU", "BRADESCO", "SANTANDER", "CAIXA", "INTER",
    "SICOOB", "SICREDI", "C6", "BTG_PACTUAL", "BANRISUL", "BANCO_DO_NORDESTE",
    "BANCO_DA_AMAZONIA", "BRB", "SAFRA", "DAYCOVAL", "MERCANTIL", "BS2", "PAGBANK",
    "MERCADO_PAGO", "STONE", "EFI", "PICPAY",
}
DIRECT_API_EXECUTORS = {
    "SANDBOX", "ASAAS", "EFI", "BANRISUL", "SICREDI", "PICPAY", "MERCADO_PAGO",
    "PAGBANK", "STONE", "INTER", "SANTANDER", "BRADESCO", "BS2", "CAIXA",
    "BANCO_DO_NORDESTE", "BANCO_DO_BRASIL",
}
CNAB_ONLY_EXECUTORS = {"SAFRA", "C6", "ITAU", "MERCANTIL"}
INSTALLED_PROVIDERS = DIRECT_API_EXECUTORS | CNAB_ONLY_EXECUTORS


@pytest.mark.bank_contract
def test_mandatory_provider_catalog_is_complete_without_fake_executors() -> None:
    codes = {item.code for item in ALL_PROVIDER_MANIFESTS}
    assert MANDATORY <= codes

    connectable = {item.code for item in banking_providers.connectable_manifests()}
    assert connectable == DIRECT_API_EXECUTORS

    for manifest in banking_providers.manifests():
        if manifest.code in INSTALLED_PROVIDERS:
            assert manifest.implementation_available is True
            assert banking_providers.installed(manifest.code) is True
        else:
            assert manifest.implementation_available is False
            assert manifest.status in {ProviderStatus.CATALOG_ONLY, ProviderStatus.HOMOLOGATION_REQUIRED}
            assert manifest.status is not ProviderStatus.PRODUCTION_READY

    for code in CNAB_ONLY_EXECUTORS:
        manifest = banking_providers.manifest(code)
        assert manifest.effective_implemented_modes() == frozenset({BankingIntegrationMode.CNAB})
        assert BankingIntegrationMode.DIRECT_API not in manifest.effective_implemented_modes()
        assert code not in connectable

    bb = banking_providers.manifest("BANCO_DO_BRASIL")
    assert bb.effective_implemented_modes() == frozenset(
        {BankingIntegrationMode.DIRECT_API, BankingIntegrationMode.CNAB}
    )
    assert BankingCapability.CNAB_400 in bb.capabilities
    assert BankingCapability.BOLETO_CREATE in bb.capabilities
    assert BankingCapability.BOLETO_HYBRID in bb.capabilities
    assert "BANCO_DO_BRASIL" in connectable


@pytest.mark.bank_contract
def test_efi_announces_only_executable_rc32_capabilities() -> None:
    manifest = banking_providers.manifest("EFI")
    assert manifest.status is ProviderStatus.IMPLEMENTED
    assert manifest.capabilities == frozenset({BankingCapability.PIX_COB, BankingCapability.BALANCE})
    assert manifest.environments == frozenset({BankingEnvironment.HOMOLOGATION, BankingEnvironment.PRODUCTION})
    assert manifest.status is not ProviderStatus.SANDBOX_VERIFIED
    assert manifest.status is not ProviderStatus.PRODUCTION_READY


@pytest.mark.bank_contract
def test_entitlement_precedence_global_override_plan() -> None:
    assert evaluate_provider_entitlement(
        driver_installed=True, globally_enabled=False, tenant_visible=True,
        tenant_override="ALLOW", plan_mode="ALL", selected_by_plan=True,
    ) == (False, "GLOBAL_DISABLED")
    assert evaluate_provider_entitlement(
        driver_installed=True, globally_enabled=True, tenant_visible=True,
        tenant_override="DENY", plan_mode="ALL", selected_by_plan=True,
    ) == (False, "TENANT_DENY")
    assert evaluate_provider_entitlement(
        driver_installed=True, globally_enabled=True, tenant_visible=True,
        tenant_override="ALLOW", plan_mode="NONE", selected_by_plan=False,
    ) == (True, "TENANT_ALLOW")
    assert evaluate_provider_entitlement(
        driver_installed=True, globally_enabled=True, tenant_visible=True,
        tenant_override="INHERIT", plan_mode="SELECTED", selected_by_plan=False,
    ) == (False, "PLAN_NOT_SELECTED")
    assert evaluate_provider_entitlement(
        driver_installed=True, globally_enabled=True, tenant_visible=False,
        tenant_override="INHERIT", plan_mode="ALL", selected_by_plan=False,
    ) == (True, "PLAN_ALL")


@pytest.mark.bank_contract
def test_hidden_provider_is_not_discoverable_but_remains_operationally_allowed() -> None:
    decision = ProviderEntitlementDecision(
        provider="INTER",
        allowed=False,
        source="TENANT_HIDDEN",
        driver_status="IMPLEMENTED",
        driver_installed=True,
        globally_enabled=True,
        tenant_visible=False,
        plan_mode="ALL",
        tenant_override="INHERIT",
        operationally_allowed=True,
    )
    payload = decision.public_dict()
    assert decision.operational_allowed is True
    assert decision.discoverable is False
    assert decision.commercial_status == "HIDDEN"
    assert payload["allowed"] is False
    assert payload["operationally_allowed"] is True
    assert payload["discoverable"] is False


@pytest.mark.bank_contract
def test_bulk_governance_input_normalizes_and_deduplicates_provider_codes() -> None:
    payload = BankProviderGovernanceBulkUpdate(
        providers=[" inter ", "INTER", "asaas"],
        globally_enabled=True,
        tenant_visible=False,
    )
    assert payload.providers == ["INTER", "ASAAS"]
    assert payload.globally_enabled is True
    assert payload.tenant_visible is False

    with pytest.raises(ValidationError):
        BankProviderGovernanceBulkUpdate(providers=[])


@pytest.mark.bank_contract
def test_sandbox_never_announces_production_environment() -> None:
    manifest = banking_providers.manifest("SANDBOX")
    assert manifest.environments == frozenset({BankingEnvironment.SANDBOX})
    assert BankingEnvironment.PRODUCTION not in manifest.environments


@pytest.mark.bank_contract
def test_manifest_public_schema_contains_no_secret_values() -> None:
    manifest = banking_providers.manifest("ASAAS")
    payload = manifest.public_dict()
    fields = {item["key"]: item for item in payload["credential_schema"]}
    assert fields["api_key"]["secret"] is True
    assert "value" not in fields["api_key"]
    assert payload["authentication"]["auth_type"] == "API_KEY"

    efi = banking_providers.manifest("EFI").public_dict()
    efi_fields = {item["key"]: item for item in efi["credential_schema"]}
    assert efi_fields["client_secret"]["secret"] is True
    assert efi_fields["certificate"]["secret"] is True
    assert efi_fields["private_key"]["secret"] is True
    assert efi_fields["pix_key"]["required"] is False
    assert "value" not in efi_fields["client_secret"]

    bb = banking_providers.manifest("BANCO_DO_BRASIL").public_dict()
    bb_fields = {item["key"]: item for item in bb["credential_schema"]}
    assert bb_fields["client_secret"]["secret"] is True
    assert bb_fields["developer_application_key"]["secret"] is True
    assert bb_fields["numero_convenio"]["required"] is True
    assert bb["authentication"]["auth_type"] == "OAUTH2_CLIENT_CREDENTIALS"


@pytest.mark.bank_contract
def test_catalog_only_provider_cannot_be_resolved_as_executor() -> None:
    with pytest.raises(APIError) as exc:
        banking_providers.get("SICOOB")
    assert exc.value.code == "BANKING_PROVIDER_NOT_AVAILABLE"


@pytest.mark.bank_contract
def test_capability_gate_rejects_unannounced_operation() -> None:
    with pytest.raises(APIError) as exc:
        banking_providers.get_for_capability("ASAAS", BankingCapability.TRANSFER_TED)
    assert exc.value.code == "BANK_CAPABILITY_NOT_SUPPORTED"

    with pytest.raises(APIError) as exc:
        banking_providers.get_for_capability("EFI", BankingCapability.PIX_COBV)
    assert exc.value.code == "BANK_CAPABILITY_NOT_SUPPORTED"


@pytest.mark.bank_contract
def test_money_never_accepts_binary_float() -> None:
    assert money("10.015") == Decimal("10.02")
    with pytest.raises(TypeError):
        money(10.01)  # type: ignore[arg-type]


@pytest.mark.bank_contract
def test_sanitizer_redacts_nested_banking_secrets() -> None:
    cleaned = sanitize_mapping({
        "client_id": "allowed",
        "client_secret": "never",
        "nested": {"private_key": "never", "access_token": "never", "status": "ok"},
    })
    assert cleaned["client_id"] == "allowed"
    assert cleaned["client_secret"] == "[REDACTED]"
    assert cleaned["nested"]["private_key"] == "[REDACTED]"
    assert cleaned["nested"]["access_token"] == "[REDACTED]"
    assert cleaned["nested"]["status"] == "ok"


@pytest.mark.bank_contract
def test_http_client_blocks_non_https_and_unlisted_hosts() -> None:
    with pytest.raises(Exception):
        BankHTTPClient(provider="TEST", base_url="http://bank.example", allowed_hosts={"bank.example"})
    with pytest.raises(Exception):
        BankHTTPClient(provider="TEST", base_url="https://evil.example", allowed_hosts={"bank.example"})


@pytest.mark.bank_contract
def test_provider_documentation_has_provenance_date_when_present() -> None:
    for manifest in banking_providers.manifests():
        for documentation in manifest.documentation:
            assert documentation.url.startswith("https://")
            assert documentation.checked_at is not None


@pytest.mark.bank_contract
def test_platform_and_tenant_migration_heads_are_banking_framework() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    platform_cfg = Config(str(backend_root / "alembic-platform.ini"))
    platform_cfg.set_main_option("script_location", str(backend_root / "migrations" / "platform"))
    platform = ScriptDirectory.from_config(platform_cfg)
    assert platform.get_current_head() == "0008_bank_provider_governance"
    assert platform.get_revision("0008_bank_provider_governance").down_revision == "0007_bank_institution_catalog"

    tenant_cfg = Config(str(backend_root / "alembic-tenant.ini"))
    tenant_cfg.set_main_option("script_location", str(backend_root / "migrations" / "tenant"))
    tenant = ScriptDirectory.from_config(tenant_cfg)
    assert tenant.get_current_head() == "0005_banking_provider_framework"
    assert tenant.get_revision("0005_banking_provider_framework").down_revision == "0004_user_mfa"


@pytest.mark.bank_contract
def test_bcb_record_parser_accepts_common_json_wrappers() -> None:
    assert BankInstitutionCatalogService._records({"value": [{"ispb": "1"}]}) == [{"ispb": "1"}]
    assert BankInstitutionCatalogService._records({"result": {"data": [{"ispb": "2"}]}}) == [{"ispb": "2"}]
    assert BankInstitutionCatalogService._records([]) == []


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_reconciliation_ambiguous_never_auto_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = ReconciliationEngine(SimpleNamespace())  # type: ignore[arg-type]
    tx = SimpleNamespace(id=uuid4())
    candidates = [
        ReconciliationCandidate(uuid4(), None, None, Decimal("85"), ("amount", "payer_tax_id")),
        ReconciliationCandidate(uuid4(), None, None, Decimal("85"), ("amount", "payer_tax_id")),
    ]
    monkeypatch.setattr(engine, "candidates", pytest.importorskip("unittest.mock").AsyncMock(return_value=candidates))
    decision = await engine.decide(tx)  # type: ignore[arg-type]
    assert decision.status == "AMBIGUOUS"
    assert decision.score == Decimal("85")
    assert decision.alternatives


@pytest.mark.bank_contract
@pytest.mark.asyncio
async def test_reconciliation_strong_existing_payment_can_auto_match(monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import AsyncMock

    engine = ReconciliationEngine(SimpleNamespace())  # type: ignore[arg-type]
    tx = SimpleNamespace(id=uuid4())
    candidate = ReconciliationCandidate(
        receivable_id=uuid4(), payment_id=uuid4(), charge_id=uuid4(),
        score=Decimal("100"), evidence=("endToEndId",), strong_identifier=True,
    )
    monkeypatch.setattr(engine, "candidates", AsyncMock(return_value=[candidate]))
    decision = await engine.decide(tx)  # type: ignore[arg-type]
    assert decision == ReconciliationDecision("AUTO_MATCHED", Decimal("100"), candidate)


@pytest.mark.bank_contract
def test_webhook_registry_does_not_install_provider_without_handler() -> None:
    import app.api.routes.tenant_banking_webhooks  # noqa: F401

    assert "ASAAS" in banking_webhooks.installed()
    assert "INTER" not in banking_webhooks.installed()
    assert "EFI" not in banking_webhooks.installed()
    assert "BANCO_DO_BRASIL" not in banking_webhooks.installed()
    with pytest.raises(APIError):
        banking_webhooks.get("INTER")
