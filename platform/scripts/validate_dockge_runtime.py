#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import yaml
from yaml.tokens import AliasToken, AnchorToken, ScalarToken

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ROOT / "deployments/dockge/compose.yaml"
ENV_EXAMPLE = ROOT / "deployments/dockge/.env.example"


def fail(message: str) -> None:
    raise SystemExit(f"[ERRO] {message}")


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def assert_plain_yaml(text: str) -> None:
    for token in yaml.scan(text):
        if isinstance(token, (AnchorToken, AliasToken)):
            fail("Compose Dockge não pode conter YAML anchors/aliases; o editor do Dockge limita aliases")
        if isinstance(token, ScalarToken) and token.value == "<<":
            fail("Compose Dockge não pode conter YAML merge keys (<<:)")


def main() -> int:
    text = COMPOSE.read_text(encoding="utf-8")
    assert_plain_yaml(text)
    data = yaml.safe_load(text)
    services = data.get("services") if isinstance(data, dict) else None
    if not isinstance(services, dict):
        fail("Compose Dockge inválido ou sem services")
    if any(isinstance(key, str) and key.startswith("x-") for key in data):
        fail("Compose Dockge deve ser plano e não usar extensões x-* para deduplicação")
    if data.get("volumes"):
        fail("Dockge não deve usar volumes Docker nomeados; use ./data-*")
    for name, service in services.items():
        if isinstance(service, dict) and "build" in service:
            fail(f"{name} ainda depende de build local")

    required = {
        "connect-preflight", "connect-domain-init", "connect-storage-init", "connect-monitoring-init",
        "connect-postgres", "connect-redis", "connect-rabbitmq", "connect-minio", "connect-minio-init",
        "connect-migrate", "connect-migrate-tenants", "connect-bootstrap", "connect-api",
        "connect-worker-default", "connect-worker-events", "connect-worker-notifications",
        "connect-worker-backups", "connect-beat", "connect-web", "connect-prometheus", "connect-grafana",
        "connect-acme", "connect-cloudpanel-agent", "connect-gateway",
    }
    missing = sorted(required - set(services))
    if missing:
        fail(f"Serviços ausentes no Dockge: {missing}")

    preflight = services.get("connect-preflight") or {}
    env_files = preflight.get("env_file") or []
    if isinstance(env_files, str):
        env_files = [env_files]
    if ".env" not in env_files:
        fail("connect-preflight precisa carregar .env para validar ACME/CloudPanel e integrações")

    publishers = [name for name, service in services.items() if isinstance(service, dict) and service.get("ports")]
    if publishers != ["connect-gateway"]:
        fail(f"Somente connect-gateway pode publicar porta; encontrado: {publishers}")

    expected = {
        "connect-preflight": "ghcr.io/YOUR_ORG/connect-api-platform-api:latest",
        "connect-domain-init": "ghcr.io/YOUR_ORG/connect-api-platform-api:latest",
        "connect-api": "ghcr.io/YOUR_ORG/connect-api-platform-api:latest",
        "connect-web": "ghcr.io/YOUR_ORG/connect-api-platform-web:latest",
        "connect-gateway": "ghcr.io/YOUR_ORG/connect-api-platform-gateway:latest",
        "connect-acme": "ghcr.io/YOUR_ORG/connect-api-platform-acme:latest",
        "connect-cloudpanel-agent": "ghcr.io/YOUR_ORG/connect-api-platform-cloudpanel-agent:latest",
    }
    for name, image in expected.items():
        service = services.get(name) or {}
        if service.get("image") != image:
            fail(f"{name} deve usar {image}")
        if service.get("pull_policy") != "always":
            fail(f"{name} deve usar pull_policy: always")

    for internal in (
        "connect-postgres", "connect-redis", "connect-rabbitmq", "connect-minio",
        "connect-prometheus", "connect-grafana",
    ):
        if (services.get(internal) or {}).get("ports"):
            fail(f"{internal} não pode publicar porta no host")

    for folder in (
        "data-postgres", "data-redis", "data-rabbitmq", "data-minio", "data-backups", "data-runtime",
        "data-celery", "data-prometheus", "data-grafana", "data-monitoring", "data-acme", "data-certs",
        "data-cloudpanel-agent",
    ):
        if folder not in text:
            fail(f"Bind mount ausente: {folder}")

    env = parse_env(ENV_EXAMPLE)
    expected_env = {
        "APP_NAME": "Connect|API Platform",
        "PLATFORM_DOMAIN": "connect-api.example.com",
        "CONTROL_PLANE_HOST": "control.connect-api.example.com",
        "ADMIN_HOST": "admin.connect-api.example.com",
        "API_HOST": "api.connect-api.example.com",
        "DEMO_HOST": "demo.connect-api.example.com",
        "TENANT_DOMAIN_ROOT": "connect-api.example.com",
        "CONNECT_API_DATA_ROOT": ".",
        "BOOTSTRAP_DEMO_TENANT": "true",
        "VITE_APP_NAME": "Connect|API Platform",
    }
    for key, value in expected_env.items():
        if env.get(key) != value:
            fail(f"{key} deve ser {value!r}, encontrado {env.get(key)!r}")
    if env.get("CLOUDFLARE_PROVISIONING_MODE") != "wildcard":
        fail("CLOUDFLARE_PROVISIONING_MODE deve ser wildcard")

    subprocess.run([sys.executable, str(ROOT / "scripts/validate_deployment_parity.py")], check=True)
    print("Dockge runtime: PASS")
    print("- YAML plano sem anchors/aliases/merge keys: OK")
    print("- connect-preflight carrega .env: OK")
    print("- branding: Connect|API Platform")
    print("- domínio padrão: connect-api.example.com")
    print("- landing/demo/control/admin/api/wildcard: OK")
    print("- image-only / GHCR latest: OK")
    print("- única porta publicada: connect-gateway")
    print("- Prometheus/Grafana internos: OK")
    print("- bind mounts ./data-*: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
