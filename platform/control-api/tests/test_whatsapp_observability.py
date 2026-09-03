from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.api.routes.control_whatsapp import _public
from app.api.routes.tenant_platform_services import _connection_payload
from app.providers.evolution import EvolutionConfig, EvolutionWhatsAppProvider
from app.services.managed_whatsapp import _tenant_instance
from app.services.observability import redact


def test_tenant_instance_is_deterministic_and_isolated() -> None:
    tenant_a = _tenant_instance("studio-beatriz", "11111111-2222-3333-4444-555555555555", "connect-api")
    tenant_b = _tenant_instance("studio-beatriz", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "connect-api")

    assert tenant_a == "connect-api-studio-beatriz-1111111122"
    assert tenant_b == "connect-api-studio-beatriz-aaaaaaaabb"
    assert tenant_a != tenant_b
    assert len(tenant_a) <= 80


def test_tenant_instance_sanitizes_slug() -> None:
    value = _tenant_instance("Cliente ÁÇ / Teste!!!", "12345678-1234-1234-1234-123456789012", "CONNECT API")

    assert value.startswith("connect-api-cliente-teste-")
    assert " " not in value
    assert "/" not in value


@pytest.mark.asyncio
async def test_pairing_code_connect_passes_phone_as_query(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = EvolutionWhatsAppProvider(
        EvolutionConfig(base_url="https://internal.example", api_key="secret", instance="tenant-1")
    )
    calls: list[tuple[str, str, dict | None, dict | None]] = []

    async def fake_request(method: str, path: str, payload=None, *, params=None, allow_not_found=False):  # noqa: ANN001
        del allow_not_found
        calls.append((method, path, payload, params))
        if "connectionState" in path:
            return {"not_found": False, "state": "close"}
        if "fetchInstances" in path:
            return {}
        if "create" in path:
            return {"instance": {"instanceName": "tenant-1"}}
        return {"pairingCode": "1234-5678", "code": "2@qr-connection-string"}

    monkeypatch.setattr(provider, "_request", fake_request)
    result = await provider.connect_instance("+55 (75) 99999-8888")

    assert result["connection"]["pairingCode"] == "1234-5678"
    connect_calls = [call for call in calls if call[1] == "/instance/connect/{instance}"]
    assert connect_calls == [
        ("GET", "/instance/connect/{instance}", None, {"number": "5575999998888"})
    ]


@pytest.mark.asyncio
async def test_instance_information_uses_filtered_inventory_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = EvolutionWhatsAppProvider(
        EvolutionConfig(base_url="https://internal.example", api_key="secret", instance="tenant-1")
    )
    calls: list[tuple[str, str, dict | None]] = []

    async def fake_request(method: str, path: str, payload=None, *, params=None, allow_not_found=False):  # noqa: ANN001
        del payload, allow_not_found
        calls.append((method, path, params))
        return {
            "data": [
                {"name": "other-tenant", "ownerJid": "5511999999999@s.whatsapp.net", "profileName": "Outro"},
                {"name": "tenant-1", "ownerJid": "5575999998888@s.whatsapp.net", "profileName": "Financeiro"},
            ]
        }

    monkeypatch.setattr(provider, "_request", fake_request)
    result = await provider.instance_information()

    assert result["name"] == "tenant-1"
    assert result["ownerJid"] == "5575999998888@s.whatsapp.net"
    assert calls == [("GET", "/instance/fetchInstances", {"instanceName": "tenant-1"})]


@pytest.mark.asyncio
async def test_instance_information_does_not_leak_ambiguous_inventory(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = EvolutionWhatsAppProvider(
        EvolutionConfig(base_url="https://internal.example", api_key="secret", instance="tenant-1")
    )

    async def fake_request(method: str, path: str, payload=None, *, params=None, allow_not_found=False):  # noqa: ANN001
        del method, path, payload, params, allow_not_found
        return {
            "data": [
                {"name": "tenant-a", "ownerJid": "5511111111111@s.whatsapp.net"},
                {"name": "tenant-b", "ownerJid": "5522222222222@s.whatsapp.net"},
            ]
        }

    monkeypatch.setattr(provider, "_request", fake_request)

    assert await provider.instance_information() == {}


@pytest.mark.asyncio
async def test_restart_preserves_linked_session_and_does_not_request_new_pairing(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = EvolutionWhatsAppProvider(
        EvolutionConfig(base_url="https://internal.example", api_key="secret", instance="tenant-1")
    )
    calls: list[tuple[str, str]] = []

    async def fake_request(method: str, path: str, payload=None, *, params=None, allow_not_found=False):  # noqa: ANN001
        del payload, params, allow_not_found
        calls.append((method, path))
        if "connectionState" in path:
            return {"state": "close"}
        if "fetchInstances" in path:
            return {
                "data": [
                    {
                        "name": "tenant-1",
                        "ownerJid": "5575999998888@s.whatsapp.net",
                        "profileName": "Financeiro",
                        "connectionStatus": "close",
                    }
                ]
            }
        if "restart" in path:
            return {"ok": True}
        raise AssertionError(f"Operação inesperada: {method} {path}")

    monkeypatch.setattr(provider, "_request", fake_request)
    result = await provider.restart_instance()

    assert result["snapshot"]["session_exists"] is True
    assert result["snapshot"]["state"] == "RECONNECTING"
    assert ("GET", "/instance/connect/{instance}") not in calls
    assert ("PUT", "/instance/restart/{instance}") in calls


def test_qr_raw_code_is_never_exposed_as_pairing_code() -> None:
    payload = {
        "code": "2@very-long-raw-qr-connection-string-that-is-not-a-pairing-code",
        "pairingCode": "ABCD-1234",
        "instance": {"state": "connecting"},
    }

    tenant = _connection_payload(payload)
    control = _public(payload)

    assert tenant["pairing_code"] == "ABCD-1234"
    assert control["pairing_code"] == "ABCD-1234"

    tenant_without_pairing = _connection_payload({"code": payload["code"]})
    control_without_pairing = _public({"code": payload["code"]})
    assert tenant_without_pairing["pairing_code"] is None
    assert control_without_pairing["pairing_code"] is None


def test_whatsapp_identity_uses_profile_name_not_technical_instance_name() -> None:
    payload = {
        "name": "connect-api-tenant-1",
        "ownerJid": "5575999998888@s.whatsapp.net",
        "profileName": "Studio Cliente",
        "connectionStatus": "open",
    }

    tenant = _connection_payload(payload)
    control = _public(payload)

    assert tenant["number"] == "5575999998888"
    assert tenant["profile_name"] == "Studio Cliente"
    assert control["number"] == "5575999998888"
    assert control["profile_name"] == "Studio Cliente"
    assert tenant["state"] == "CONNECTED"
    assert control["state"] == "CONNECTED"


def test_platform_migration_graph_resolves_banking_catalog_head() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    cfg = Config(str(backend_root / "alembic-platform.ini"))
    cfg.set_main_option("script_location", str(backend_root / "migrations" / "platform"))
    script = ScriptDirectory.from_config(cfg)

    assert script.get_current_head() == "0008_bank_provider_governance"
    assert script.get_revision("0008_bank_provider_governance").down_revision == "0007_bank_institution_catalog"
    assert script.get_revision("0007_bank_institution_catalog").down_revision == "0006_landing_builder"
    assert script.get_revision("0006_landing_builder").down_revision == "0005_control_plane_mfa"
    assert script.get_revision("0005_control_plane_mfa").down_revision == "0004_domain_management"
    assert script.get_revision("0004_domain_management").down_revision == "0003_platform_observability"
    assert script.get_revision("0003_platform_observability").down_revision == "0002_control_complete"


def test_observability_redacts_nested_secrets_and_bearer_tokens() -> None:
    payload = {
        "username": "financeiro",
        "password": "should-not-leak",
        "nested": {
            "api_key": "abc123",
            "message": "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
            "items": [{"token": "xyz"}, {"safe": True}],
        },
    }

    cleaned = redact(payload)

    assert cleaned["username"] == "financeiro"
    assert cleaned["password"] == "[REDACTED]"
    assert cleaned["nested"]["api_key"] == "[REDACTED]"
    assert "eyJhbGci" not in cleaned["nested"]["message"]
    assert "[REDACTED]" in cleaned["nested"]["message"]
    assert cleaned["nested"]["items"][0]["token"] == "[REDACTED]"
    assert cleaned["nested"]["items"][1]["safe"] is True
