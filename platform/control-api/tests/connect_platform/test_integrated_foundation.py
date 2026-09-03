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
    assert "connect-engine:" in compose
    assert "connect-platform-api:" in compose
    assert "connect-platform-web:" in compose
    assert "connect-gateway:" in compose


def test_reference_financial_domain_is_disabled_by_default() -> None:
    cfg = (PLATFORM / "control-api" / "app" / "core" / "config.py").read_text(encoding="utf-8")
    main = (PLATFORM / "control-api" / "app" / "main.py").read_text(encoding="utf-8")
    assert "enable_reference_financial_domain: bool = False" in cfg
    assert "if settings.enable_reference_financial_domain:" in main
