#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
STACKS = [
    ROOT / "compose.yaml",
    ROOT / "deployments/docker/compose.images.yaml",
    ROOT / "deployments/production/compose.yaml",
    ROOT / "deployments/dockge/compose.yaml",
    ROOT / "deployments/cloudpanel/compose.yaml",
    ROOT / "deployments/portainer/stack.yaml",
]
ENV_FILES = [
    ROOT / ".env.example",
    ROOT / "deployments/docker/.env.example",
    ROOT / "deployments/production/.env.example",
    ROOT / "deployments/dockge/.env.example",
    ROOT / "deployments/cloudpanel/.env.example",
    ROOT / "deployments/portainer/.env.example",
    ROOT / "deployments/portainer/stack.env.example",
]
REQUIRED_SERVICES = {
    "connect-preflight",
    "connect-domain-init",
    "connect-storage-init",
    "connect-monitoring-init",
    "connect-postgres",
    "connect-redis",
    "connect-rabbitmq",
    "connect-minio",
    "connect-minio-init",
    "connect-migrate",
    "connect-migrate-tenants",
    "connect-bootstrap",
    "connect-api",
    "connect-worker-default",
    "connect-worker-events",
    "connect-worker-notifications",
    "connect-worker-backups",
    "connect-beat",
    "connect-web",
    "connect-prometheus",
    "connect-grafana",
    "connect-docker-proxy",
    "connect-log-agent",
    "connect-acme",
    "connect-cloudpanel-agent",
    "connect-gateway",
}
EXPECTED_IMAGES = {
    "connect-api": "ghcr.io/YOUR_ORG/connect-api-platform-api:latest",
    "connect-web": "ghcr.io/YOUR_ORG/connect-api-platform-web:latest",
    "connect-gateway": "ghcr.io/YOUR_ORG/connect-api-platform-gateway:latest",
    "connect-acme": "ghcr.io/YOUR_ORG/connect-api-platform-acme:latest",
    "connect-cloudpanel-agent": "ghcr.io/YOUR_ORG/connect-api-platform-cloudpanel-agent:latest",
    "connect-log-agent": "ghcr.io/YOUR_ORG/connect-api-platform-api:latest",
}
errors: list[str] = []


def environment(service: dict) -> dict:
    value = service.get("environment") or {}
    return value if isinstance(value, dict) else {}


if (ROOT / "deployments/portainer/stack-build.yaml").exists():
    errors.append(
        "deployments/portainer/stack-build.yaml não deve existir; build local fica somente em compose.local-build.yaml"
    )

for path in STACKS:
    if not path.exists():
        errors.append(f"{path.relative_to(ROOT)}: arquivo ausente")
        continue
    text = path.read_text(encoding="utf-8")
    if "\nbuild:" in text or "\n    build:" in text or "dockerfile:" in text:
        errors.append(f"{path.relative_to(ROOT)}: deployment de produção contém build local")
    if "redis://localhost" in text:
        errors.append(f"{path.relative_to(ROOT)}: deployment de produção referencia Redis em localhost")
    try:
        data = yaml.safe_load(text) or {}
    except Exception as exc:
        errors.append(f"{path.relative_to(ROOT)}: YAML inválido: {exc}")
        continue
    services = data.get("services") or {}
    missing = sorted(REQUIRED_SERVICES - set(services))
    if missing:
        errors.append(f"{path.relative_to(ROOT)}: serviços ausentes: {', '.join(missing)}")
        continue

    publishers = [name for name, service in services.items() if service.get("ports")]
    if publishers != ["connect-gateway"]:
        errors.append(
            f"{path.relative_to(ROOT)}: somente connect-gateway pode publicar porta; encontrados: {publishers}"
        )

    for service, expected in EXPECTED_IMAGES.items():
        value = (services.get(service) or {}).get("image")
        if value != expected:
            errors.append(
                f"{path.relative_to(ROOT)}: {service}.image deve ser {expected!r}, encontrado {value!r}"
            )

    for internal in (
        "connect-postgres",
        "connect-redis",
        "connect-rabbitmq",
        "connect-minio",
        "connect-prometheus",
        "connect-grafana",
        "connect-docker-proxy",
        "connect-log-agent",
    ):
        if (services.get(internal) or {}).get("ports"):
            errors.append(f"{path.relative_to(ROOT)}: {internal} não pode publicar porta no host")

    api = services["connect-api"]
    agent = services["connect-log-agent"]
    proxy = services["connect-docker-proxy"]
    api_env = environment(api)
    agent_env = environment(agent)
    proxy_env = environment(proxy)

    if "connect-log-agent:8091" not in str(api_env.get("LOG_AGENT_URL") or ""):
        errors.append(f"{path.relative_to(ROOT)}: connect-api sem LOG_AGENT_URL interno")
    if "INTERNAL_SERVICES_PASSWORD" not in str(api_env.get("INTERNAL_SERVICES_PASSWORD") or ""):
        errors.append(f"{path.relative_to(ROOT)}: connect-api sem segredo interno dedicado")
    if agent_env.get("DOCKER_API_URL") != "http://connect-docker-proxy:2375":
        errors.append(f"{path.relative_to(ROOT)}: connect-log-agent não usa proxy Docker interno")
    if "INTERNAL_SERVICES_PASSWORD" not in str(agent_env.get("INTERNAL_SERVICES_PASSWORD") or ""):
        errors.append(f"{path.relative_to(ROOT)}: connect-log-agent sem segredo interno dedicado")
    if str(proxy_env.get("POST")) != "0" or str(proxy_env.get("CONTAINERS")) != "1":
        errors.append(f"{path.relative_to(ROOT)}: proxy Docker não está restrito a leitura de containers")
    if proxy.get("privileged") or agent.get("privileged"):
        errors.append(f"{path.relative_to(ROOT)}: observabilidade não pode executar privileged")
    if agent.get("volumes"):
        errors.append(f"{path.relative_to(ROOT)}: connect-log-agent não pode montar Docker socket")
    if not any(str(volume).endswith(":/var/run/docker.sock:ro") for volume in proxy.get("volumes", [])):
        errors.append(f"{path.relative_to(ROOT)}: proxy Docker sem socket somente leitura")
    if "connect-observability" not in (proxy.get("networks") or []):
        errors.append(f"{path.relative_to(ROOT)}: proxy Docker fora da rede isolada de observabilidade")
    if not ((data.get("networks") or {}).get("connect-observability") or {}).get("internal"):
        errors.append(f"{path.relative_to(ROOT)}: rede connect-observability precisa ser internal")

for path in ENV_FILES:
    if not path.exists():
        errors.append(f"{path.relative_to(ROOT)}: env example ausente")
        continue
    text = path.read_text(encoding="utf-8")
    required = [
        "APP_NAME=Connect|API Platform",
        "PLATFORM_DOMAIN=connect-api.example.com",
        "CONTROL_PLANE_HOST=control.connect-api.example.com",
        "ADMIN_HOST=admin.connect-api.example.com",
        "API_HOST=api.connect-api.example.com",
        "DEMO_HOST=demo.connect-api.example.com",
        "TENANT_DOMAIN_ROOT=connect-api.example.com",
        "VITE_APP_NAME=Connect|API Platform",
        "INTERNAL_SERVICES_PASSWORD=",
        "LOG_AGENT_URL=http://connect-log-agent:8091",
    ]
    for item in required:
        if item not in text:
            errors.append(f"{path.relative_to(ROOT)}: esperado {item}")
    lines = {line.strip() for line in text.splitlines()}
    if "APP_NAME=Connect|API" in lines or "VITE_APP_NAME=Connect|API" in lines:
        errors.append(f"{path.relative_to(ROOT)}: nome curto não pode substituir o nome canônico Connect|API Platform")

for path in (
    ROOT / "infrastructure/nginx/gateway.conf.template",
    ROOT / "infrastructure/docker/gateway/landing/index.html",
    ROOT / "infrastructure/docker/gateway/Dockerfile",
):
    if not path.exists():
        errors.append(f"{path.relative_to(ROOT)}: arquivo obrigatório ausente")

if errors:
    print("DEPLOYMENT_PARITY=FAIL")
    for error in errors:
        print(f"- {error}")
    raise SystemExit(1)

print("DEPLOYMENT_PARITY=PASS")
print(f"STACKS={len(STACKS)}")
print(f"REQUIRED_SERVICES={len(REQUIRED_SERVICES)}")
print("PUBLIC_HOST_PORT=connect-gateway")
print("OBSERVABILITY=connect-log-agent+connect-docker-proxy")
print("DEFAULT_DOMAIN=connect-api.example.com")
