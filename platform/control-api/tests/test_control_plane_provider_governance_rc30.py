from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.banking import BankConnectionCreate
from app.schemas.banking_governance import BankProviderGovernanceBulkUpdate
from app.services.banking_entitlements import ProviderEntitlementDecision


@pytest.mark.bank_contract
def test_bank_connection_rejects_cnab_only_provider() -> None:
    with pytest.raises(ValidationError, match="não possui executor DIRECT_API"):
        BankConnectionCreate(
            company_id=uuid4(),
            bank_account_id=uuid4(),
            provider="MERCANTIL",
            environment="PRODUCTION",
            credentials={},
        )


@pytest.mark.bank_contract
def test_bank_connection_rejects_manual_institution_binding() -> None:
    with pytest.raises(ValidationError, match="institution_id não pode ser associado manualmente"):
        BankConnectionCreate(
            company_id=uuid4(),
            bank_account_id=uuid4(),
            institution_id=uuid4(),
            provider="ASAAS",
            environment="PRODUCTION",
            credentials={},
        )


@pytest.mark.bank_contract
def test_bulk_governance_normalizes_provider_identity() -> None:
    payload = BankProviderGovernanceBulkUpdate(
        providers=[" inter ", "INTER", "asaas"],
        globally_enabled=True,
        tenant_visible=False,
    )
    assert payload.providers == ["INTER", "ASAAS"]


@pytest.mark.bank_contract
def test_hidden_provider_keeps_operational_entitlement_separate_from_discovery() -> None:
    decision = ProviderEntitlementDecision(
        provider="INTER",
        allowed=False,
        source="TENANT_HIDDEN",
        driver_status="IMPLEMENTED",
        driver_installed=True,
        globally_enabled=True,
        tenant_visible=False,
        plan_mode="ALL",
        tenant_override=None,
        operationally_allowed=True,
    )
    assert decision.operational_allowed is True
    assert decision.discoverable is False
    assert decision.public_dict()["commercial_status"] == "HIDDEN"


@pytest.mark.bank_contract
def test_provider_aware_cnab_never_falls_back_to_generic_bank_layout() -> None:
    route = Path(__file__).resolve().parents[1] / "app" / "api" / "routes" / "tenant_cnab_providers.py"
    source = route.read_text(encoding="utf-8")
    assert "LEGACY_GENERIC_CNAB" not in source
    assert "CNAB240Generator(" not in source
    assert "CNAB400Generator(" not in source
    assert "banking_providers.get_for_mode(provider_code, BankingIntegrationMode.CNAB)" in source
