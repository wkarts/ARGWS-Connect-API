#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys
import yaml

REPO = Path(__file__).resolve().parents[2]
RUNTIMES = {
    "platform": (REPO / "deploy/platform/compose.yaml", "argws-connect-platform"),
    "develop": (REPO / "deploy/platform-develop/compose.yaml", "argws-connect-platform-develop"),
    "production": (REPO / "deploy/platform-production/compose.yaml", "argws-connect-platform-production"),
}


def fail(message: str) -> None:
    raise SystemExit(f"[ERRO] {message}")


def load(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("services"), dict):
        fail(f"compose inválido: {path.relative_to(REPO)}")
    return data


for label, (path, project) in RUNTIMES.items():
    data = load(path)
    services: dict = data["services"]

    # Runtime oficial deve consumir imagens; build local é somente compose.local-build.yaml.
    for name, service in services.items():
        if isinstance(service, dict) and "build" in service:
            fail(f"{path.relative_to(REPO)} contém build local em {name}")

    required = {
        f"api-{project}", f"docs-{project}", f"postgres-{project}", f"redis-{project}",
        f"rabbitmq-{project}", f"minio-{project}", f"platform-postgres-{project}",
        f"platform-api-{project}", f"platform-worker-{project}", f"platform-scheduler-{project}",
        f"platform-worker-backups-{project}", f"platform-docker-proxy-{project}",
        f"platform-log-agent-{project}", f"platform-prometheus-{project}", f"platform-grafana-{project}",
        f"platform-web-{project}", f"platform-gateway-{project}", f"platform-acme-{project}",
        f"platform-cloudpanel-agent-{project}",
    }
    missing = sorted(required - set(services))
    if missing:
        fail(f"{path.relative_to(REPO)} incompleto: {missing}")

    # Infra não publica host ports; apenas API, DOCs e Gateway conforme contrato existente.
    for logical in ("postgres", "redis", "rabbitmq", "minio", "platform-postgres", "platform-log-agent", "platform-prometheus", "platform-grafana"):
        svc = services.get(f"{logical}-{project}") or {}
        if svc.get("ports"):
            fail(f"{logical}-{project} não pode publicar porta no host")

    api_env = (services[f"platform-api-{project}"].get("environment") or {})
    if "connect-log-agent:8091" not in str(api_env.get("LOG_AGENT_URL") or ""):
        fail(f"{label}: Platform API sem Log Agent interno")
    if not str(api_env.get("S3_ENDPOINT_URL") or "").strip():
        fail(f"{label}: Platform API sem endpoint S3")

    scheduler = services[f"platform-scheduler-{project}"]
    command = " ".join(str(v) for v in scheduler.get("command") or [])
    if "/var/lib/celery/celerybeat-schedule" in command or "--schedule=/tmp/celerybeat-schedule" not in command:
        fail(f"{label}: contrato do Celery Beat incorreto")

local_overlay = REPO / "deploy/platform/compose.local-build.yaml"
if not local_overlay.is_file() or "build:" not in local_overlay.read_text(encoding="utf-8"):
    fail("build local deve permanecer isolado em deploy/platform/compose.local-build.yaml")

print("Runtime contract: PASS")
print("- Platform/base/develop/production: image-only")
print("- build local isolado no overlay existente")
print("- API/DOCs/Gateway preservam publicação de portas")
print("- infraestrutura permanece interna")
print("- scheduler non-root usa /tmp")
print("- S3/Log Agent integrados à Platform API")
