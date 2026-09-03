from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app.api.routes.control_whatsapp import router as control_whatsapp_router
from app.core.errors import APIError
from app.providers.evolution import EvolutionConfig, EvolutionWhatsAppProvider


ROOT = Path(__file__).resolve().parents[2]

PRODUCTION_MANIFESTS = (
    ROOT / "compose.yaml",
    ROOT / "deployments" / "docker" / "compose.images.yaml",
    ROOT / "deployments" / "production" / "compose.yaml",
    ROOT / "deployments" / "portainer" / "stack.yaml",
    ROOT / "deployments" / "dockge" / "compose.yaml",
    ROOT / "deployments" / "cloudpanel" / "compose.yaml",
)

PRODUCTION_ENV_EXAMPLES = (
    ROOT / ".env.example",
    ROOT / "deployments" / "docker" / ".env.example",
    ROOT / "deployments" / "production" / ".env.example",
    ROOT / "deployments" / "portainer" / ".env.example",
    ROOT / "deployments" / "dockge" / ".env.example",
    ROOT / "deployments" / "cloudpanel" / ".env.example",
)


def _service_environment(service: dict) -> dict:
    value = service.get("environment") or {}
    assert isinstance(value, dict)
    return value


@pytest.mark.parametrize("manifest", PRODUCTION_MANIFESTS, ids=lambda path: str(path.relative_to(ROOT)))
def test_every_production_manifest_contains_operational_log_agent(manifest: Path) -> None:
    compose = yaml.safe_load(manifest.read_text(encoding="utf-8"))
    services = compose["services"]
    networks = compose["networks"]

    assert "connect-log-agent" in services, f"{manifest} sem connect-log-agent"
    assert "connect-docker-proxy" in services, f"{manifest} sem connect-docker-proxy"

    api = services["connect-api"]
    agent = services["connect-log-agent"]
    proxy = services["connect-docker-proxy"]
    api_env = _service_environment(api)
    agent_env = _service_environment(agent)
    proxy_env = _service_environment(proxy)

    assert "connect-log-agent:8091" in str(api_env.get("LOG_AGENT_URL") or "")
    assert "INTERNAL_SERVICES_PASSWORD" in str(api_env.get("INTERNAL_SERVICES_PASSWORD") or "")
    assert agent_env.get("DOCKER_API_URL") == "http://connect-docker-proxy:2375"
    assert "INTERNAL_SERVICES_PASSWORD" in str(agent_env.get("INTERNAL_SERVICES_PASSWORD") or "")

    assert not agent.get("ports")
    assert not proxy.get("ports")
    assert not agent.get("privileged")
    assert not proxy.get("privileged")
    assert str(proxy_env.get("POST")) == "0"
    assert str(proxy_env.get("CONTAINERS")) == "1"
    assert any(str(volume).endswith(":/var/run/docker.sock:ro") for volume in proxy.get("volumes", []))
    assert "connect-observability" in proxy.get("networks", [])
    assert networks["connect-observability"]["internal"] is True

    raw = manifest.read_text(encoding="utf-8")
    assert "redis://localhost" not in raw, f"{manifest} contém dependência localhost inválida"


@pytest.mark.parametrize("env_file", PRODUCTION_ENV_EXAMPLES, ids=lambda path: str(path.relative_to(ROOT)))
def test_every_production_env_exposes_dedicated_internal_secret(env_file: Path) -> None:
    content = env_file.read_text(encoding="utf-8")
    assert "INTERNAL_SERVICES_PASSWORD=" in content
    assert "LOG_AGENT_URL=http://connect-log-agent:8091" in content


def test_control_plane_whatsapp_test_route_cannot_be_captured_as_generic_action() -> None:
    paths = [route.path for route in control_whatsapp_router.routes]
    assert "/api/control/v1/whatsapp/instances/{tenant_id}/test-message" in paths
    assert "/api/control/v1/whatsapp/instances/{tenant_id}/actions/{action}" in paths
    assert "/api/control/v1/whatsapp/instances/{tenant_id}/{action}" not in paths

    frontend = (ROOT / "frontend" / "src" / "pages" / "PlatformWhatsAppPage.vue").read_text(encoding="utf-8")
    assert "/actions/${value}" in frontend
    assert "/test-message" in frontend


@pytest.mark.asyncio
async def test_evolution_send_text_uses_scheduler_pro_compatible_contract_first(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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


@pytest.mark.asyncio
async def test_evolution_send_text_recovers_from_stale_configured_path_on_404(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = EvolutionWhatsAppProvider(
        EvolutionConfig(
            base_url="https://evolution.internal",
            api_key="secret",
            instance="tenant-1",
            send_text_path="/api/messages/send/{instance}",
        )
    )
    paths: list[str] = []

    async def fake_request(method: str, path: str, payload=None, **kwargs):  # noqa: ANN001
        del method, payload, kwargs
        paths.append(path)
        if len(paths) == 1:
            raise APIError(
                "WHATSAPP_SERVICE_ERROR",
                "O serviço de WhatsApp recusou a operação solicitada.",
                424,
                {"status_code": 404, "path": path},
            )
        return {"key": {"id": "message-canonical"}}

    monkeypatch.setattr(provider, "_request", fake_request)
    result = await provider.send_text("5575999998888", "Teste")

    assert paths == ["/api/messages/send/{instance}", "/message/sendText/{instance}"]
    assert result.external_id == "message-canonical"


@pytest.mark.asyncio
async def test_evolution_send_text_uses_modern_payload_only_after_explicit_schema_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = EvolutionWhatsAppProvider(
        EvolutionConfig(base_url="https://evolution.internal", api_key="secret", instance="tenant-1")
    )
    payloads: list[dict] = []

    async def fake_request(method: str, path: str, payload=None, **kwargs):  # noqa: ANN001
        del method, path, kwargs
        payloads.append(payload)
        if len(payloads) == 1:
            raise APIError(
                "WHATSAPP_SERVICE_ERROR",
                "O serviço de WhatsApp recusou a operação solicitada.",
                424,
                {"status_code": 422, "provider_message": "property textMessage is not allowed"},
            )
        return {"key": {"id": "message-modern"}}

    monkeypatch.setattr(provider, "_request", fake_request)
    result = await provider.send_text("5575999998888", "Teste")

    assert payloads == [
        {"number": "5575999998888", "textMessage": {"text": "Teste"}},
        {"number": "5575999998888", "text": "Teste"},
    ]
    assert result.external_id == "message-modern"


@pytest.mark.asyncio
async def test_evolution_send_text_does_not_repeat_ambiguous_server_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = EvolutionWhatsAppProvider(
        EvolutionConfig(base_url="https://evolution.internal", api_key="secret", instance="tenant-1")
    )
    calls = 0

    async def fake_request(method: str, path: str, payload=None, **kwargs):  # noqa: ANN001
        nonlocal calls
        del method, path, payload, kwargs
        calls += 1
        raise APIError(
            "WHATSAPP_SERVICE_ERROR",
            "O serviço de WhatsApp recusou a operação solicitada.",
            424,
            {"status_code": 500, "provider_message": "erro interno"},
        )

    monkeypatch.setattr(provider, "_request", fake_request)
    with pytest.raises(APIError):
        await provider.send_text("5575999998888", "Não duplicar")

    assert calls == 1
