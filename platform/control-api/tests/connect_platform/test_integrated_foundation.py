from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
PLATFORM = REPO / "platform"


def test_canonical_version_is_shared() -> None:
    version = (REPO / "VERSION").read_text(encoding="utf-8").strip()
    package = json.loads((REPO / "package.json").read_text(encoding="utf-8"))
    pyproject = (PLATFORM / "control-api" / "pyproject.toml").read_text(encoding="utf-8")
    assert package["version"] == version
    assert f'version = "{version}"' in pyproject


def test_engine_bridge_is_internal_and_tenant_scoped() -> None:
    route = (PLATFORM / "control-api" / "app" / "api" / "routes" / "tenant_engine.py").read_text(encoding="utf-8")
    client = (PLATFORM / "control-api" / "app" / "services" / "connect_engine.py").read_text(encoding="utf-8")
    assert 'prefix="/api/v1/connect"' in route
    assert "EngineBinding" in route
    assert "tenant_id" in route
    assert 'return {"apikey": key' in client
    assert "CONNECT_ENGINE_API_KEY" not in (PLATFORM / "web" / "src" / "api" / "connectEngine.ts").read_text(encoding="utf-8")


def test_manager_is_declared_deprecated() -> None:
    assert (REPO / "manager" / "DEPRECATED.md").is_file()
    compose = (REPO / "deploy" / "platform" / "compose.yaml").read_text(encoding="utf-8")
    assert 'SERVER_DISABLE_MANAGER: "true"' in compose


def test_deployment_profiles_exist() -> None:
    compose = (REPO / "deploy" / "platform" / "compose.yaml").read_text(encoding="utf-8")
    assert "profiles: [docs, platform]" in compose
    assert "profiles: [platform]" in compose
    assert "api-argws-connect-platform:" in compose
    assert "platform-api-argws-connect-platform:" in compose
    assert "platform-web-argws-connect-platform:" in compose
    assert "platform-gateway-argws-connect-platform:" in compose


def test_platform_local_build_overlay_keeps_project_identity() -> None:
    compose = (REPO / "deploy" / "platform" / "compose.yaml").read_text(encoding="utf-8")
    overlay = (REPO / "deploy" / "platform" / "compose.local-build.yaml").read_text(encoding="utf-8")
    env = (REPO / "deploy" / "platform" / "env.example").read_text(encoding="utf-8")
    expected = "name: ${COMPOSE_PROJECT_NAME:-argws-connect-platform}\n"
    assert compose.startswith(expected)
    assert overlay.startswith(expected)
    assert "COMPOSE_PROJECT_NAME=argws-connect-platform" in env
    assert "ARGWS_CONNECT_NETWORK_NAME=argws-connect-platform-net" in env


def test_reference_financial_domain_is_disabled_by_default() -> None:
    cfg = (PLATFORM / "control-api" / "app" / "core" / "config.py").read_text(encoding="utf-8")
    main = (PLATFORM / "control-api" / "app" / "main.py").read_text(encoding="utf-8")
    assert "enable_reference_financial_domain: bool = False" in cfg
    assert "if settings.enable_reference_financial_domain:" in main


def test_platform_develop_is_standalone_and_complete() -> None:
    classic = REPO / "deploy" / "develop"
    standalone = REPO / "deploy" / "platform-develop"
    compose = (standalone / "compose.yaml").read_text(encoding="utf-8")
    env = (standalone / "env.example").read_text(encoding="utf-8")

    assert not (classic / "compose.platform.yaml").exists()
    assert not (classic / "platform.env.example").exists()
    assert compose.startswith("name: ${COMPOSE_PROJECT_NAME:-argws-connect-platform-develop}\n")
    assert "COMPOSE_PROJECT_NAME=argws-connect-platform-develop" in env
    assert "ARGWS_CONNECT_NETWORK_NAME=argws-connect-platform-develop-net" in env
    assert "ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:develop" in env
    assert "ARGWS_CONNECT_DOCS_IMAGE=ghcr.io/wkarts/argws-connect-docs:develop" in env
    assert "ARGWS_CONNECT_PLATFORM_API_IMAGE=ghcr.io/wkarts/argws-connect-platform-api:develop" in env
    assert "ARGWS_CONNECT_PLATFORM_WEB_IMAGE=ghcr.io/wkarts/argws-connect-platform-web:develop" in env
    assert "ARGWS_CONNECT_PLATFORM_GATEWAY_IMAGE=ghcr.io/wkarts/argws-connect-platform-gateway:develop" in env
    assert "SERVER_URL=https://d.api.connect.argws.com.br" in env
    assert "ARGWS_CONNECT_DOCS_PUBLIC_URL=https://d.docs.connect.argws.com.br" in env
    assert "PLATFORM_DOMAIN=d.connect.argws.com.br" in env
    assert "CONTROL_PLANE_HOST=d.control.connect.argws.com.br" in env
    assert "PARTNER_PLANE_HOST=d.partner.connect.argws.com.br" in env
    assert "DEMO_HOST=d.demo.connect.argws.com.br" in env
    assert "api-argws-connect-platform-develop:" in compose
    assert "docs-argws-connect-platform-develop:" in compose
    assert "postgres-argws-connect-platform-develop:" in compose
    assert "platform-postgres-argws-connect-platform-develop:" in compose
    assert "platform-api-argws-connect-platform-develop:" in compose
    assert "platform-worker-argws-connect-platform-develop:" in compose
    assert "platform-scheduler-argws-connect-platform-develop:" in compose
    assert "platform-web-argws-connect-platform-develop:" in compose
    assert "platform-gateway-argws-connect-platform-develop:" in compose
    assert "profiles: [platform]" not in compose


def test_running_engine_instances_can_be_adopted_without_recreation() -> None:
    route = (PLATFORM / "control-api" / "app" / "api" / "routes" / "tenant_connect.py").read_text(encoding="utf-8")
    frontend = (PLATFORM / "web" / "src" / "api" / "connectEngine.ts").read_text(encoding="utf-8")
    page = (PLATFORM / "web" / "src" / "pages" / "ConnectInstancesPage.vue").read_text(encoding="utf-8")
    assert '/connect/instances/discover' in route
    assert '/connect/instances/adopt' in route
    assert '"origin": "ADOPTED_EXISTING"' in route
    assert '"engine_mutated": False' in route
    assert '/connect/instances/{binding_id}/detach' in route
    assert "discoverEngineInstances" in frontend
    assert "adoptEngineInstance" in frontend
    assert "detachEngineInstance" in frontend
    assert "Adotar existente" in page
    assert "Adotar sem recriar" in page
