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


def test_existing_develop_stack_can_be_upgraded_in_place() -> None:
    base = (REPO / "deploy" / "develop" / "compose.yaml").read_text(encoding="utf-8")
    overlay = (REPO / "deploy" / "develop" / "compose.platform.yaml").read_text(encoding="utf-8")
    env = (REPO / "deploy" / "develop" / "platform.env.example").read_text(encoding="utf-8")
    assert "api-argws-connect-develop:" in base
    assert "./volumes/instances" in base
    assert overlay.startswith("name: ${COMPOSE_PROJECT_NAME:-argws-connect-develop}\n")
    assert "COMPOSE_PROJECT_NAME=argws-connect-develop" in env
    assert "ARGWS_CONNECT_NETWORK_NAME=argws-connect-develop-net" in env
    assert "api-argws-connect-develop:" in overlay
    assert "aliases: [connect-engine, argws-connect-api]" in overlay
    assert "platform-postgres-argws-connect-develop:" in overlay
    assert "\n  connect-engine:\n" not in overlay
    assert "BOOTSTRAP_DEMO_TENANT=false" in env


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
