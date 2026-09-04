#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys

import yaml

REPO = Path(__file__).resolve().parents[2]
STACKS = {
    "platform": (REPO / "deploy/platform/compose.yaml", "argws-connect-platform"),
    "platform-develop": (REPO / "deploy/platform-develop/compose.yaml", "argws-connect-platform-develop"),
    "platform-production": (REPO / "deploy/platform-production/compose.yaml", "argws-connect-platform-production"),
}

REQUIRED_LOGICAL = {
    "api", "docs", "postgres", "redis", "rabbitmq", "minio",
    "platform-postgres", "platform-migrate", "platform-migrate-tenants",
    "platform-bootstrap", "platform-api", "platform-worker", "platform-scheduler",
    "platform-worker-backups", "platform-docker-proxy", "platform-log-agent",
    "platform-prometheus", "platform-grafana", "platform-acme",
    "platform-cloudpanel-agent", "platform-web", "platform-gateway",
}

errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def load(path: Path) -> dict:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:  # noqa: BLE001
        fail(f"{path.relative_to(REPO)}: YAML inválido: {exc}")
        return {}
    if not isinstance(value, dict):
        fail(f"{path.relative_to(REPO)}: raiz YAML inválida")
        return {}
    return value


def logical_service_names(services: dict, project: str) -> set[str]:
    suffix = f"-{project}"
    result: set[str] = set()
    for name in services:
        if not isinstance(name, str) or not name.endswith(suffix):
            fail(f"serviço fora da convenção <recurso>-{project}: {name}")
            continue
        result.add(name[: -len(suffix)])
    return result


baseline: set[str] | None = None
for label, (path, project) in STACKS.items():
    if not path.is_file():
        fail(f"{path.relative_to(REPO)}: arquivo ausente")
        continue
    data = load(path)
    services = data.get("services") or {}
    if not isinstance(services, dict):
        fail(f"{path.relative_to(REPO)}: services ausente")
        continue

    name = str(data.get("name") or "")
    if project not in name:
        fail(f"{path.relative_to(REPO)}: project name não preserva {project}")

    logical = logical_service_names(services, project)
    missing = sorted(REQUIRED_LOGICAL - logical)
    if missing:
        fail(f"{path.relative_to(REPO)}: serviços Platform ausentes: {', '.join(missing)}")
    if baseline is None:
        baseline = logical
    elif logical != baseline:
        fail(f"{path.relative_to(REPO)}: conjunto de serviços diverge da stack Platform base")

    for service_name, service in services.items():
        if not isinstance(service, dict):
            continue
        if service.get("container_name") != service_name:
            fail(f"{path.relative_to(REPO)}: container_name divergente em {service_name}")
        if "build" in service:
            fail(f"{path.relative_to(REPO)}: build local encontrado em runtime image-only ({service_name})")

    allowed_publishers = {
        f"api-{project}", f"docs-{project}", f"platform-gateway-{project}",
    }
    publishers = {name for name, service in services.items() if isinstance(service, dict) and service.get("ports")}
    unexpected = sorted(publishers - allowed_publishers)
    if unexpected:
        fail(f"{path.relative_to(REPO)}: portas publicadas fora de API/DOCs/Gateway: {unexpected}")

    scheduler = services.get(f"platform-scheduler-{project}") or {}
    scheduler_command = " ".join(str(item) for item in (scheduler.get("command") or []))
    if "--schedule=/tmp/celerybeat-schedule" not in scheduler_command:
        fail(f"{path.relative_to(REPO)}: scheduler não usa schedule gravável em /tmp")

    proxy = services.get(f"platform-docker-proxy-{project}") or {}
    proxy_env = proxy.get("environment") or {}
    if str(proxy_env.get("POST")) != "0" or str(proxy_env.get("CONTAINERS")) != "1":
        fail(f"{path.relative_to(REPO)}: Docker Proxy não está restrito a leitura")
    if not any("/var/run/docker.sock:ro" in str(v) for v in proxy.get("volumes", [])):
        fail(f"{path.relative_to(REPO)}: Docker Proxy sem socket read-only")

    agent = services.get(f"platform-log-agent-{project}") or {}
    if agent.get("volumes"):
        fail(f"{path.relative_to(REPO)}: Log Agent não deve montar Docker socket")
    if (agent.get("environment") or {}).get("DOCKER_API_URL") != "http://connect-docker-proxy:2375":
        fail(f"{path.relative_to(REPO)}: Log Agent não usa Docker Proxy interno")

    for optional in (f"platform-acme-{project}", f"platform-cloudpanel-agent-{project}"):
        if (services.get(optional) or {}).get("profiles") != ["cloudpanel"]:
            fail(f"{path.relative_to(REPO)}: {optional} deve permanecer no profile cloudpanel")

    api = services.get(f"platform-api-{project}") or {}
    env = api.get("environment") or {}
    for key in (
        "S3_ENDPOINT_URL", "S3_BUCKET_PREFIX", "CLOUDFLARE_ENABLED", "CLOUDFLARE_API_TOKEN",
        "LOG_AGENT_URL", "BACKUP_ENABLED", "BACKUP_S3_BUCKET", "PROMETHEUS_BASE_URL", "GRAFANA_BASE_URL",
    ):
        if key not in env:
            fail(f"{path.relative_to(REPO)}: Platform API sem variável operacional {key}")

    env_path = path.with_name("env.example")
    if not env_path.is_file():
        fail(f"{env_path.relative_to(REPO)}: env example ausente")
    else:
        env_text = env_path.read_text(encoding="utf-8")
        for token in (
            f"COMPOSE_PROJECT_NAME={project}",
            f"ARGWS_CONNECT_NETWORK_NAME={project}-net",
            "PLATFORM_S3_ENDPOINT_URL=",
            "CLOUDFLARE_ENABLED=",
            "BACKUP_ENABLED=",
        ):
            if token not in env_text:
                fail(f"{env_path.relative_to(REPO)}: esperado {token}")

if errors:
    print("DEPLOYMENT_PARITY=FAIL")
    for item in errors:
        print(f"- {item}")
    raise SystemExit(1)

print("DEPLOYMENT_PARITY=PASS")
print(f"STACKS={len(STACKS)}")
print(f"SERVICES={len(REQUIRED_LOGICAL)}")
print("DEPLOY_PATTERN=preserved")
print("OBSERVABILITY=docker-proxy+log-agent+prometheus+grafana")
print("ACME_CLOUDPANEL=optional-profile")
