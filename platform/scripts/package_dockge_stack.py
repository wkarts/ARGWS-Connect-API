#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
PERSISTENT_DIRS = (
    "data-postgres",
    "data-redis",
    "data-rabbitmq",
    "data-minio",
    "data-backups",
    "data-runtime",
    "data-celery",
    "data-prometheus",
    "data-grafana",
    "data-monitoring",
    "data-acme",
    "data-certs",
    "data-cloudpanel-agent",
)
DOCKER_SOCKET_PROXY_IMAGE = "ghcr.io/tecnativa/docker-socket-proxy:v0.5.0"
INTERNAL_SECRET = "${INTERNAL_SERVICES_PASSWORD:?INTERNAL_SERVICES_PASSWORD obrigatória}"
DOCKER_SOCKET_VOLUME = "${DOCKER_SOCKET_PATH:-/var/run/docker.sock}:/var/run/docker.sock:ro"


class NoAliasDumper(yaml.SafeDumper):
    """Dumper sem anchors/aliases para compatibilidade com o editor do Dockge."""

    def ignore_aliases(self, data: object) -> bool:
        return True


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_alias_free_yaml(text: str) -> None:
    try:
        tokens = list(yaml.scan(text))
    except yaml.YAMLError as exc:
        raise SystemExit(f"Render Dockge gerou YAML inválido: {exc}") from exc
    for token in tokens:
        if isinstance(token, (yaml.tokens.AnchorToken, yaml.tokens.AliasToken)):
            raise SystemExit("Render Dockge ainda contém YAML anchor/alias")
        if isinstance(token, yaml.tokens.ScalarToken) and token.value == "<<":
            raise SystemExit("Render Dockge ainda contém YAML merge key")


def inject_observability_agent(data: dict) -> None:
    services = data.get("services")
    networks = data.setdefault("networks", {})
    if not isinstance(services, dict) or not isinstance(networks, dict):
        raise SystemExit("Compose sem services/networks válidos")

    networks.setdefault("connect-observability", {"internal": True})

    api = services.get("connect-api")
    if not isinstance(api, dict):
        raise SystemExit("Compose Dockge sem connect-api")
    api_environment = api.setdefault("environment", {})
    if not isinstance(api_environment, dict):
        raise SystemExit("connect-api.environment inválido")
    api_environment["LOG_AGENT_URL"] = "http://connect-log-agent:8091"
    api_environment["INTERNAL_SERVICES_PASSWORD"] = INTERNAL_SECRET
    api_environment["OBSERVABILITY_TAIL_MAX_LINES"] = "5000"
    api_environment["OBSERVABILITY_BUNDLE_MAX_MB"] = "100"
    api_environment["RUNTIME_LOG_RETENTION_DAYS"] = "30"

    if "connect-docker-proxy" not in services:
        services["connect-docker-proxy"] = {
            "image": DOCKER_SOCKET_PROXY_IMAGE,
            "restart": "unless-stopped",
            "environment": {
                "CONTAINERS": "1",
                "INFO": "1",
                "PING": "1",
                "VERSION": "1",
                "POST": "0",
                "AUTH": "0",
                "BUILD": "0",
                "COMMIT": "0",
                "CONFIGS": "0",
                "DISTRIBUTION": "0",
                "EVENTS": "0",
                "EXEC": "0",
                "GRPC": "0",
                "IMAGES": "0",
                "NETWORKS": "0",
                "NODES": "0",
                "PLUGINS": "0",
                "SECRETS": "0",
                "SERVICES": "0",
                "SESSION": "0",
                "SWARM": "0",
                "SYSTEM": "0",
                "TASKS": "0",
                "VOLUMES": "0",
            },
            "volumes": [DOCKER_SOCKET_VOLUME],
            "read_only": True,
            "tmpfs": ["/run:rw,noexec,nosuid,size=16m", "/tmp:rw,noexec,nosuid,size=16m"],
            "networks": ["connect-observability"],
            "security_opt": ["no-new-privileges:true"],
            "logging": {"driver": "local", "options": {"max-size": "20m", "max-file": "5"}},
        }

    if "connect-log-agent" not in services:
        services["connect-log-agent"] = {
            "image": "ghcr.io/YOUR_ORG/connect-api-platform-api:latest",
            "pull_policy": "always",
            "restart": "unless-stopped",
            "env_file": [".env"],
            "environment": {
                "COMPOSE_PROJECT_NAME": "${COMPOSE_PROJECT_NAME:-connect-api-platform}",
                "DOCKER_API_URL": "http://connect-docker-proxy:2375",
                "LOG_AGENT_PORT": "8091",
                "INTERNAL_SERVICES_PASSWORD": INTERNAL_SECRET,
            },
            "command": ["python", "-m", "app.log_agent"],
            "depends_on": {"connect-docker-proxy": {"condition": "service_started"}},
            "read_only": True,
            "tmpfs": ["/tmp:rw,noexec,nosuid,size=32m"],
            "healthcheck": {
                "test": [
                    "CMD-SHELL",
                    "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/health',timeout=5).read()\"",
                ],
                "interval": "20s",
                "timeout": "8s",
                "retries": 10,
                "start_period": "15s",
            },
            "networks": ["connect-internal", "connect-observability"],
            "security_opt": ["no-new-privileges:true"],
            "logging": {"driver": "local", "options": {"max-size": "20m", "max-file": "5"}},
        }


def validate_observability_agent(parsed: dict) -> None:
    services = parsed.get("services") or {}
    agent = services.get("connect-log-agent") or {}
    proxy = services.get("connect-docker-proxy") or {}
    api = services.get("connect-api") or {}
    for name, service in (("connect-log-agent", agent), ("connect-docker-proxy", proxy)):
        if service.get("ports"):
            raise SystemExit(f"{name} não pode publicar porta no host")
        if service.get("privileged"):
            raise SystemExit(f"{name} não pode ser privileged")
    if agent.get("volumes"):
        raise SystemExit("connect-log-agent não pode montar o Docker socket")
    if agent.get("environment", {}).get("DOCKER_API_URL") != "http://connect-docker-proxy:2375":
        raise SystemExit("connect-log-agent precisa usar o proxy Docker interno")
    if api.get("environment", {}).get("LOG_AGENT_URL") != "http://connect-log-agent:8091":
        raise SystemExit("connect-api precisa usar o agente de logs interno")
    if agent.get("environment", {}).get("INTERNAL_SERVICES_PASSWORD") != INTERNAL_SECRET:
        raise SystemExit("connect-log-agent precisa compartilhar o segredo interno da API")
    if api.get("environment", {}).get("INTERNAL_SERVICES_PASSWORD") != INTERNAL_SECRET:
        raise SystemExit("connect-api precisa compartilhar o segredo interno do agente")
    proxy_volumes = proxy.get("volumes") or []
    if DOCKER_SOCKET_VOLUME not in proxy_volumes:
        raise SystemExit("connect-docker-proxy precisa do Docker socket somente leitura")
    proxy_env = proxy.get("environment") or {}
    if str(proxy_env.get("POST")) != "0" or str(proxy_env.get("CONTAINERS")) != "1":
        raise SystemExit("connect-docker-proxy deve bloquear POST e liberar somente leitura de containers")
    if "connect-observability" not in (proxy.get("networks") or []):
        raise SystemExit("connect-docker-proxy deve ficar isolado na rede de observabilidade")


def render_dockge_compose(source: Path) -> str:
    raw = source.read_text(encoding="utf-8")
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise SystemExit(f"Compose Dockge de origem inválido: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("services"), dict):
        raise SystemExit("Compose Dockge inválido ou sem services")

    for key in list(data):
        if isinstance(key, str) and key.startswith("x-"):
            data.pop(key, None)

    preflight = data["services"].get("connect-preflight")
    if not isinstance(preflight, dict):
        raise SystemExit("Compose Dockge sem connect-preflight")
    preflight["env_file"] = [".env"]

    inject_observability_agent(data)

    rendered = yaml.dump(
        data,
        Dumper=NoAliasDumper,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        width=100000,
    )
    rendered = (
        "# Connect|API Platform — Dockge/CloudPanel, produção por imagens.\n"
        "# YAML plano, sem recursos de reutilização que excedam limites do parser do Dockge.\n"
        "# O connect-preflight lê também o .env completo para validar o perfil CloudPanel/ACME.\n"
        "# Logs Docker passam por proxy interno sem operações de escrita; nenhum serviço de observabilidade publica porta.\n\n"
        + rendered
    )

    assert_alias_free_yaml(rendered)
    parsed = yaml.safe_load(rendered)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("services"), dict):
        raise SystemExit("Render Dockge perdeu a seção services")
    if set(parsed["services"]) != set(data["services"]):
        raise SystemExit("Render Dockge alterou a lista de serviços")
    packaged_preflight = parsed["services"].get("connect-preflight") or {}
    if ".env" not in (packaged_preflight.get("env_file") or []):
        raise SystemExit("Render Dockge não entrega o .env completo ao connect-preflight")
    validate_observability_agent(parsed)
    return rendered


def main() -> int:
    parser = argparse.ArgumentParser(description="Empacota a stack Dockge/CloudPanel image-only pronta para extração.")
    parser.add_argument("--output-dir", type=Path, default=ROOT.parent)
    args = parser.parse_args()

    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if not version:
        raise SystemExit("VERSION vazia")

    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"Connect-API-Platform-v{version}-Dockge.zip"
    archive.unlink(missing_ok=True)

    compose = ROOT / "deployments/dockge/compose.yaml"
    env_example = ROOT / "deployments/dockge/.env.example"
    readme = ROOT / "deployments/dockge/README.md"
    for path in (compose, env_example, readme):
        if not path.is_file():
            raise SystemExit(f"Arquivo Dockge ausente: {path.relative_to(ROOT)}")

    compose_text = compose.read_text(encoding="utf-8")
    if "build:" in compose_text or "dockerfile:" in compose_text:
        raise SystemExit("Compose Dockge ainda contém build local")

    for image in (
        "ghcr.io/YOUR_ORG/connect-api-platform-api:latest",
        "ghcr.io/YOUR_ORG/connect-api-platform-web:latest",
        "ghcr.io/YOUR_ORG/connect-api-platform-gateway:latest",
        "ghcr.io/YOUR_ORG/connect-api-platform-acme:latest",
        "ghcr.io/YOUR_ORG/connect-api-platform-cloudpanel-agent:latest",
    ):
        if image not in compose_text:
            raise SystemExit(f"Compose Dockge não usa imagem esperada: {image}")

    for service in (
        "connect-preflight",
        "connect-domain-init",
        "connect-prometheus",
        "connect-grafana",
        "connect-acme",
        "connect-cloudpanel-agent",
    ):
        if service not in compose_text:
            raise SystemExit(f"Compose Dockge não contém {service}")

    rendered_compose = render_dockge_compose(compose)

    with tempfile.TemporaryDirectory(prefix="multitenant-app-dockge-") as tmp:
        root = Path(tmp) / "connect-api-platform"
        root.mkdir(parents=True)
        (root / "compose.yaml").write_text(rendered_compose, encoding="utf-8")
        (root / ".env.example").write_bytes(env_example.read_bytes())
        (root / "README.md").write_bytes(readme.read_bytes())

        for folder in (*PERSISTENT_DIRS, "secrets"):
            directory = root / folder
            directory.mkdir()
            (directory / ".gitkeep").write_text("", encoding="utf-8")
        (root / "secrets" / "rclone.conf").write_text("", encoding="utf-8")
        (root / "secrets" / "backup-age-identity.txt").write_text("", encoding="utf-8")

        manifest = {
            "application": "Connect|API Platform",
            "version": version,
            "deployment": "dockge-cloudpanel",
            "mode": "image-only",
            "runtime_images": "ghcr-latest",
            "published_ports": ["connect-gateway"],
            "default_domain": "connect-api.example.com",
            "demo_domain": "demo.connect-api.example.com",
            "tenant_wildcard": "*.connect-api.example.com",
            "data_root": ".",
            "persistent_directories": list(PERSISTENT_DIRS),
            "internal_only_services": ["postgres", "redis", "rabbitmq", "minio", "prometheus", "grafana", "docker-proxy", "log-agent"],
            "yaml_aliases": "expanded-none",
            "preflight_env_source": ".env",
            "observability": {
                "structured_logs": True,
                "docker_log_agent": "internal",
                "docker_socket": "isolated-behind-read-only-proxy",
                "docker_proxy_image": DOCKER_SOCKET_PROXY_IMAGE,
                "docker_api_post": False,
                "published_port": False,
            },
            "automatic_domain_runtime": {
                "dns": "cloudflare-wildcard",
                "certificate": "acme-dns01",
                "cloudpanel": "host-agent-clpctl",
                "manual_step": "single-reverse-proxy",
            },
        }
        (root / "DOCKGE_PACKAGE.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    zf.write(path, arcname=path.relative_to(root.parent).as_posix())

    with zipfile.ZipFile(archive) as zf:
        bad = zf.testzip()
        if bad:
            raise SystemExit(f"ZIP Dockge corrompido: {bad}")
        packaged_compose = zf.read("connect-api-platform/compose.yaml").decode("utf-8")
        assert_alias_free_yaml(packaged_compose)
        packaged_data = yaml.safe_load(packaged_compose)
        if not isinstance(packaged_data, dict) or not isinstance(packaged_data.get("services"), dict):
            raise SystemExit("ZIP Dockge contém compose.yaml inválido")
        packaged_preflight = packaged_data["services"].get("connect-preflight") or {}
        if ".env" not in (packaged_preflight.get("env_file") or []):
            raise SystemExit("ZIP Dockge perdeu env_file .env do connect-preflight")
        validate_observability_agent(packaged_data)

    print(json.dumps({
        "status": "PASS",
        "version": version,
        "archive": str(archive),
        "sha256": sha256(archive),
        "yaml_aliases": 0,
        "services": len(packaged_data["services"]),
        "preflight_env": ".env",
        "log_agent": "internal-via-read-only-docker-proxy",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
