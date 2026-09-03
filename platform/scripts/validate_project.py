#!/usr/bin/env python3
from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None

REPO = Path(__file__).resolve().parents[2]
PLATFORM = REPO / "platform"
CONTROL = PLATFORM / "control-api"
WEB = PLATFORM / "web"
ERRORS: list[str] = []
WARNINGS: list[str] = []
METRICS: dict[str, Any] = {}


def error(message: str) -> None:
    ERRORS.append(message)


def warning(message: str) -> None:
    WARNINGS.append(message)


def required_files() -> None:
    paths = [
        REPO / "VERSION",
        REPO / "package.json",
        REPO / ".github/workflows/auto-version-release.yml",
        REPO / ".github/workflows/ghcr-publish-application.yml",
        REPO / "deploy/platform/compose.yaml",
        REPO / "deploy/platform/env.example",
        REPO / "manager/DEPRECATED.md",
        PLATFORM / "RC34_ORIGIN.md",
        CONTROL / "Dockerfile",
        CONTROL / "pyproject.toml",
        CONTROL / "app/main.py",
        CONTROL / "app/version.py",
        CONTROL / "app/services/connect_engine.py",
        CONTROL / "app/api/routes/tenant_engine.py",
        WEB / "Dockerfile",
        WEB / "package.json",
        WEB / "vite.config.ts",
        WEB / "src/router/index.ts",
        WEB / "src/api/connectEngine.ts",
        PLATFORM / "gateway/Dockerfile",
        PLATFORM / "gateway/default.conf.template",
    ]
    for path in paths:
        if not path.is_file():
            error(f"Arquivo obrigatório ausente: {path.relative_to(REPO)}")


def validate_python() -> None:
    count = 0
    for base in (CONTROL / "app", CONTROL / "tests/connect_platform", PLATFORM / "scripts"):
        if not base.exists():
            continue
        for path in sorted(base.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            count += 1
            try:
                ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            except SyntaxError as exc:
                error(f"Python inválido: {path.relative_to(REPO)}:{exc.lineno}: {exc.msg}")
    METRICS["python_files"] = count


def validate_shell() -> None:
    count = 0
    for base in (PLATFORM / "scripts", REPO / "deploy/platform"):
        if not base.exists():
            continue
        for path in sorted(base.rglob("*.sh")):
            count += 1
            result = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True, check=False)
            if result.returncode:
                error(f"Shell inválido: {path.relative_to(REPO)}: {result.stderr.strip()}")
    METRICS["shell_scripts"] = count


def validate_yaml() -> None:
    if yaml is None:
        warning("PyYAML indisponível; validação YAML reduzida")
        return
    count = 0
    roots = [REPO / "deploy/platform", REPO / ".github/workflows", PLATFORM]
    seen: set[Path] = set()
    for root in roots:
        for suffix in ("*.yaml", "*.yml"):
            for path in sorted(root.rglob(suffix)):
                if path in seen or any(p in {"node_modules", "reference-origin"} for p in path.parts):
                    continue
                seen.add(path)
                count += 1
                try:
                    yaml.safe_load(path.read_text(encoding="utf-8"))
                except Exception as exc:  # noqa: BLE001
                    error(f"YAML inválido: {path.relative_to(REPO)}: {exc}")
    METRICS["yaml_files"] = count


def validate_versioning() -> None:
    version = (REPO / "VERSION").read_text(encoding="utf-8").strip()
    package = json.loads((REPO / "package.json").read_text(encoding="utf-8"))
    pyproject = (CONTROL / "pyproject.toml").read_text(encoding="utf-8")
    vite = (WEB / "vite.config.ts").read_text(encoding="utf-8")
    backend_version = (CONTROL / "app/version.py").read_text(encoding="utf-8")
    if package.get("version") != version:
        error(f"package.json ({package.get('version')}) diverge de VERSION ({version})")
    if f'version = "{version}"' not in pyproject:
        error("Control API não está alinhada ao VERSION canônico")
    if "../../VERSION" not in vite or "VITE_APP_VERSION" not in vite:
        error("Platform Web não lê VERSION canônico")
    if 'os.getenv("APP_VERSION"' not in backend_version or '"VERSION"' not in backend_version:
        error("Platform Control API não resolve APP_VERSION/VERSION canônico")
    METRICS["canonical_version"] = version


def validate_lifecycle() -> None:
    develop = (REPO / ".github/workflows/ghcr-publish-application.yml").read_text(encoding="utf-8")
    release = (REPO / ".github/workflows/auto-version-release.yml").read_text(encoding="utf-8")
    for component in ("platform-api", "platform-web", "platform-gateway"):
        if component not in develop:
            error(f"Workflow develop não publica {component}")
        if component not in release:
            error(f"Workflow release não publica {component}")
    for image in ("argws-connect-platform-api", "argws-connect-platform-web", "argws-connect-platform-gateway"):
        if image not in develop or image not in release:
            error(f"Imagem Platform fora do lifecycle canônico: {image}")


def validate_deployments() -> None:
    compose = (REPO / "deploy/platform/compose.yaml").read_text(encoding="utf-8")
    env = (REPO / "deploy/platform/env.example").read_text(encoding="utf-8")
    if 'SERVER_DISABLE_MANAGER: "true"' not in compose:
        error("Deployment Platform não desativa Manager legado")
    required_services = [
        "connect-engine:", "connect-docs:", "connect-platform-api:", "connect-platform-web:",
        "connect-platform-worker:", "connect-platform-scheduler:", "connect-gateway:",
    ]
    for service in required_services:
        if service not in compose:
            error(f"Serviço ausente no deployment Platform: {service[:-1]}")
    if "profiles: [docs, platform]" not in compose:
        error("DOCs não está compartilhada entre profiles docs/platform")
    if "CONNECT_API_VERSION=" not in env:
        error("env.example da Platform não declara CONNECT_API_VERSION")


def validate_specialization() -> None:
    routes_init = (CONTROL / "app/api/routes/__init__.py").read_text(encoding="utf-8")
    models_init = (CONTROL / "app/models/__init__.py").read_text(encoding="utf-8")
    config = (CONTROL / "app/core/config.py").read_text(encoding="utf-8")
    if "control_banking" in routes_init or "tenant_finance" in routes_init:
        error("Pacote de rotas ainda importa domínio financeiro de forma eager")
    if "banking" in models_init:
        error("Models canônicos ainda importam domínio financeiro por padrão")
    if "enable_reference_financial_domain: bool = False" not in config:
        error("Domínio financeiro de referência não está desativado por padrão")
    settings_page = (WEB / "src/pages/ControlSettingsPage.vue").read_text(encoding="utf-8")
    if "EVOLUTION" in settings_page:
        warning("ControlSettingsPage ainda contém nomenclatura EVOLUTION do RC34; manter apenas como compatibilidade temporária")


def validate_bridge() -> None:
    route = (CONTROL / "app/api/routes/tenant_engine.py").read_text(encoding="utf-8")
    client = (CONTROL / "app/services/connect_engine.py").read_text(encoding="utf-8")
    web_client = (WEB / "src/api/connectEngine.ts").read_text(encoding="utf-8")
    for endpoint in ("instances", "templates", "actions", "recipes", "send-template", "send-text"):
        if endpoint not in route:
            error(f"Bridge não expõe domínio essencial: {endpoint}")
    if 'return {"apikey": key' not in client:
        error("Engine client não injeta chave server-side")
    if "CONNECT_ENGINE_API_KEY" in web_client or "apikey" in web_client.lower():
        error("Frontend expõe conhecimento da chave global do Engine")


def validate_manager_deprecation() -> None:
    text = (REPO / "manager/DEPRECATED.md").read_text(encoding="utf-8")
    if "desativ" not in text.lower() and "deprecated" not in text.lower():
        error("manager/DEPRECATED.md não documenta desativação")


def validate_cache_cleanliness() -> None:
    offenders: list[str] = []
    for pattern in ("**/__pycache__", "**/.pytest_cache", "platform/web/node_modules", "platform/web/dist"):
        for path in REPO.glob(pattern):
            if path.exists():
                offenders.append(str(path.relative_to(REPO)))
    if offenders:
        error("Artefatos transitórios presentes: " + ", ".join(sorted(set(offenders))))


def main() -> int:
    required_files()
    validate_python()
    validate_shell()
    validate_yaml()
    validate_versioning()
    validate_lifecycle()
    validate_deployments()
    validate_specialization()
    validate_bridge()
    validate_manager_deprecation()
    validate_cache_cleanliness()
    print(json.dumps({"status": "PASS" if not ERRORS else "FAIL", "metrics": METRICS, "warnings": WARNINGS, "errors": ERRORS}, ensure_ascii=False, indent=2))
    return 1 if ERRORS else 0


if __name__ == "__main__":
    raise SystemExit(main())
