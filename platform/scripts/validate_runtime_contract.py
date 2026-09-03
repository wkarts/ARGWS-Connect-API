#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys

import yaml

ROOT = Path(__file__).resolve().parents[1]
RUNTIMES = [
    ROOT / "compose.yaml",
    ROOT / "deployments/docker/compose.images.yaml",
    ROOT / "deployments/dockge/compose.yaml",
    ROOT / "deployments/cloudpanel/compose.yaml",
    ROOT / "deployments/production/compose.yaml",
    ROOT / "deployments/portainer/stack.yaml",
]
CLOUDPANEL_RUNTIMES = {
    ROOT / "deployments/dockge/compose.yaml",
    ROOT / "deployments/cloudpanel/compose.yaml",
}
CORE_SERVICES = {
    "connect-preflight",
    "connect-storage-init",
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
    "connect-gateway",
}


def fail(message: str) -> None:
    raise SystemExit(f"[ERRO] {message}")


def has_build(value: object) -> bool:
    if isinstance(value, dict):
        if "build" in value:
            return True
        return any(has_build(item) for item in value.values())
    if isinstance(value, list):
        return any(has_build(item) for item in value)
    return False


def load(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        fail(f"YAML inválido: {path.relative_to(ROOT)}")
    return data


def command_text(service: dict) -> str:
    command = service.get("command") or []
    if isinstance(command, str):
        return command
    return "\n".join(str(item) for item in command)


def validate_runtime(path: Path) -> None:
    data = load(path)
    if has_build(data):
        fail(f"build local encontrado em deployment: {path.relative_to(ROOT)}")

    services = data.get("services")
    if not isinstance(services, dict):
        fail(f"services ausente em {path.relative_to(ROOT)}")

    missing = sorted(CORE_SERVICES - set(services))
    if missing:
        fail(f"serviços obrigatórios ausentes em {path.relative_to(ROOT)}: {missing}")

    publishers = [
        name for name, service in services.items()
        if isinstance(service, dict) and service.get("ports")
    ]
    if publishers != ["connect-gateway"]:
        fail(f"{path.relative_to(ROOT)} publica portas em {publishers}; esperado somente connect-gateway")

    for internal in ("connect-postgres", "connect-redis", "connect-rabbitmq", "connect-minio"):
        service = services.get(internal)
        if not isinstance(service, dict) or service.get("ports"):
            fail(f"{internal} não pode publicar porta no host em {path.relative_to(ROOT)}")

    gateway = services.get("connect-gateway")
    if not isinstance(gateway, dict) or len(gateway.get("ports") or []) != 1:
        fail(f"gateway precisa de exatamente um bind em {path.relative_to(ROOT)}")

    expected_images = {
        "connect-preflight": "ghcr.io/YOUR_ORG/connect-api-platform-api:latest",
        "connect-api": "ghcr.io/YOUR_ORG/connect-api-platform-api:latest",
        "connect-web": "ghcr.io/YOUR_ORG/connect-api-platform-web:latest",
        "connect-gateway": "ghcr.io/YOUR_ORG/connect-api-platform-gateway:latest",
    }
    for name, expected in expected_images.items():
        service = services.get(name)
        if not isinstance(service, dict) or service.get("image") != expected:
            fail(f"{name} deve usar {expected} em {path.relative_to(ROOT)}")
        if service.get("pull_policy") != "always":
            fail(f"{name} deve usar pull_policy=always em {path.relative_to(ROOT)}")

    if path in CLOUDPANEL_RUNTIMES:
        required = {"connect-domain-init", "connect-acme", "connect-cloudpanel-agent"}
        missing_cloudpanel = sorted(required - set(services))
        if missing_cloudpanel:
            fail(f"runtime CloudPanel incompleto em {path.relative_to(ROOT)}: {missing_cloudpanel}")

        for name, expected in {
            "connect-domain-init": "ghcr.io/YOUR_ORG/connect-api-platform-api:latest",
            "connect-acme": "ghcr.io/YOUR_ORG/connect-api-platform-acme:latest",
            "connect-cloudpanel-agent": "ghcr.io/YOUR_ORG/connect-api-platform-cloudpanel-agent:latest",
        }.items():
            service = services.get(name)
            if not isinstance(service, dict) or service.get("image") != expected:
                fail(f"{name} deve usar {expected} em {path.relative_to(ROOT)}")
            if service.get("pull_policy") != "always":
                fail(f"{name} deve usar pull_policy=always em {path.relative_to(ROOT)}")
            if service.get("ports"):
                fail(f"{name} não pode publicar porta no host")

        agent = services["connect-cloudpanel-agent"]
        if agent.get("privileged") is not True or agent.get("pid") != "host" or agent.get("network_mode") != "host":
            fail("connect-cloudpanel-agent precisa do contrato host privilegiado sem portas")
        if "/:/host:rw" not in (agent.get("volumes") or []):
            fail("connect-cloudpanel-agent precisa montar / em /host:rw")

        text = path.read_text(encoding="utf-8")
        for token in ("data-acme", "data-certs", "data-cloudpanel-agent"):
            if token not in text:
                fail(f"{token} ausente em {path.relative_to(ROOT)}")

        monitoring_init = services.get("connect-monitoring-init")
        if not isinstance(monitoring_init, dict):
            fail(f"connect-monitoring-init ausente em {path.relative_to(ROOT)}")
        monitoring_command = command_text(monitoring_init)
        for directory in (
            "/config/grafana/provisioning/datasources",
            "/config/grafana/provisioning/dashboards",
            "/config/grafana/provisioning/plugins",
            "/config/grafana/provisioning/alerting",
        ):
            if directory not in monitoring_command:
                fail(f"diretório Grafana ausente em {path.relative_to(ROOT)}: {directory}")


def main() -> int:
    for path in RUNTIMES:
        validate_runtime(path)

    dockge = (ROOT / "deployments/dockge/compose.yaml").read_bytes()
    cloudpanel = (ROOT / "deployments/cloudpanel/compose.yaml").read_bytes()
    if dockge != cloudpanel:
        fail("Dockge e CloudPanel precisam compartilhar o mesmo runtime CloudPanel-aware")

    acme_entrypoint = (ROOT / "infrastructure/acme/entrypoint.sh").read_text(encoding="utf-8")
    for token in ('ACME_LOG_LEVEL="${ACME_LOG_LEVEL:-1}"', 'export LOG_LEVEL="$ACME_LOG_LEVEL"'):
        if token not in acme_entrypoint:
            fail("ACME precisa normalizar LOG_LEVEL para valor numérico antes de executar acme.sh")

    local = yaml.safe_load((ROOT / "compose.local-build.yaml").read_text(encoding="utf-8"))
    if not has_build(local):
        fail("compose.local-build.yaml não contém build local explícito")

    for path in (ROOT / "deployments").rglob("*.yaml"):
        if path.name == "stack-build.yaml":
            disabled = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            if has_build(disabled):
                fail("stack-build.yaml do Portainer não pode conter build")
            continue
        if path in RUNTIMES or path.name.endswith(".override.yaml"):
            continue
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if has_build(data):
            fail(f"deployment auxiliar contém build local: {path.relative_to(ROOT)}")

    print("Runtime contract: PASS")
    print("- deployments image-only: OK")
    print("- única porta publicada: connect-gateway")
    print("- serviços internos sem host ports: OK")
    print("- Dockge/CloudPanel com wildcard ACME automático: OK")
    print("- Grafana provisioning completo: OK")
    print("- ACME LOG_LEVEL numérico: OK")
    print("- build local isolado em compose.local-build.yaml: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
