from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app.api.routes.tenant_downloads import router as downloads_router
from app.core.errors import APIError
from app.providers.evolution import EvolutionConfig, EvolutionWhatsAppProvider


ROOT = Path(__file__).resolve().parents[2]


def test_public_landing_proxies_api_before_static_fallback() -> None:
    template = (ROOT / "infrastructure" / "nginx" / "gateway.conf.template").read_text(encoding="utf-8")
    public_start = template.index("server_name ${PLATFORM_DOMAIN};")
    api_location = template.index("location /api/", public_start)
    static_fallback = template.index("try_files $uri $uri/ /index.html", public_start)

    assert api_location < static_fallback
    assert "proxy_pass http://financial_api;" in template[api_location:static_fallback]


def test_canonical_compose_contains_internal_read_only_log_agent() -> None:
    compose = yaml.safe_load((ROOT / "compose.yaml").read_text(encoding="utf-8"))
    services = compose["services"]
    api = services["connect-api"]
    agent = services["connect-log-agent"]
    proxy = services["connect-docker-proxy"]

    assert api["environment"]["LOG_AGENT_URL"] == "${LOG_AGENT_URL:-http://connect-log-agent:8091}"
    assert "INTERNAL_SERVICES_PASSWORD" in api["environment"]
    assert not agent.get("ports")
    assert not proxy.get("ports")
    assert agent["environment"]["DOCKER_API_URL"] == "http://connect-docker-proxy:2375"
    assert agent["environment"]["INTERNAL_SERVICES_PASSWORD"].startswith("${INTERNAL_SERVICES_PASSWORD:")
    assert proxy["environment"]["POST"] == "0"
    assert proxy["environment"]["CONTAINERS"] == "1"
    assert any(str(volume).endswith(":/var/run/docker.sock:ro") for volume in proxy["volumes"])
    assert "connect-observability" in proxy["networks"]
    assert compose["networks"]["connect-observability"]["internal"] is True


def test_document_and_export_download_routes_exist() -> None:
    paths = {route.path for route in downloads_router.routes}
    assert "/api/v1/documents/{document_id}/download" in paths
    assert "/api/v1/exports/{export_id}/download" in paths


@pytest.mark.asyncio
async def test_evolution_send_text_uses_scheduler_compatible_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = EvolutionWhatsAppProvider(
        EvolutionConfig(base_url="https://evolution.internal", api_key="secret", instance="tenant-1")
    )
    calls: list[tuple[str, str, dict | None]] = []

    async def fake_request(method: str, path: str, payload=None, **kwargs):  # noqa: ANN001
        del kwargs
        calls.append((method, path, payload))
        return {"key": {"id": "message-1"}}

    monkeypatch.setattr(provider, "_request", fake_request)
    result = await provider.send_text("5575999998888", "Mensagem financeira")

    assert calls == [
        (
            "POST",
            "/message/sendText/{instance}",
            {"number": "5575999998888", "textMessage": {"text": "Mensagem financeira"}},
        )
    ]
    assert result.external_id == "message-1"
    assert result.status == "SENT"


@pytest.mark.asyncio
async def test_evolution_send_text_falls_back_to_modern_payload_only_on_schema_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = EvolutionWhatsAppProvider(
        EvolutionConfig(base_url="https://evolution.internal", api_key="secret", instance="tenant-1")
    )
    calls: list[dict] = []

    async def fake_request(method: str, path: str, payload=None, **kwargs):  # noqa: ANN001
        del method, path, kwargs
        calls.append(payload)
        if len(calls) == 1:
            raise APIError(
                "WHATSAPP_SERVICE_ERROR",
                "O serviço de WhatsApp recusou a operação solicitada.",
                424,
                {"status_code": 422, "provider_message": "property textMessage is not allowed"},
            )
        return {"key": {"id": "modern-message-1"}}

    monkeypatch.setattr(provider, "_request", fake_request)
    result = await provider.send_text("5575999998888", "Mensagem compatível")

    assert calls[0] == {
        "number": "5575999998888",
        "textMessage": {"text": "Mensagem compatível"},
    }
    assert calls[1] == {"number": "5575999998888", "text": "Mensagem compatível"}
    assert result.external_id == "modern-message-1"


def test_secret_generator_repairs_existing_env_without_internal_agent_key() -> None:
    source = (ROOT / "scripts" / "generate_secrets.py").read_text(encoding="utf-8")
    assert '"INTERNAL_SERVICES_PASSWORD": keep_or_generate(' in source
    assert 'central_mode = "INITIAL_ADMIN_PASSWORD" in current' in source
