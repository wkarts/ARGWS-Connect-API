from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

STACKS = (
    {
        "path": "deploy/platform/compose.yaml",
        "suffix": "argws-connect-platform",
        "network": "argws-connect-platform-net",
        "image": "ghcr.io/wkarts/argws-connect-platform-api:latest",
        "profile": "    profiles: [platform]\n",
    },
    {
        "path": "deploy/platform-develop/compose.yaml",
        "suffix": "argws-connect-platform-develop",
        "network": "argws-connect-platform-develop-net",
        "image": "ghcr.io/wkarts/argws-connect-platform-api:develop",
        "profile": "",
    },
    {
        "path": "deploy/platform-production/compose.yaml",
        "suffix": "argws-connect-platform-production",
        "network": "argws-connect-platform-production-net",
        "image": "ghcr.io/wkarts/argws-connect-platform-api:latest",
        "profile": "",
    },
)

for spec in STACKS:
    path = ROOT / spec["path"]
    text = path.read_text(encoding="utf-8")
    suffix = spec["suffix"]
    network = spec["network"]
    init_service = f"platform-observability-init-{suffix}"
    prometheus_service = f"platform-prometheus-{suffix}"
    grafana_service = f"platform-grafana-{suffix}"
    api_service = f"platform-api-{suffix}"

    marker = f"  {prometheus_service}:\n"
    if marker not in text:
        raise RuntimeError(f"Serviço Prometheus não encontrado em {path}")

    if f"  {init_service}:\n" not in text:
        init_block = (
            f"  {init_service}:\n"
            f"    container_name: {init_service}\n"
            f"    image: ${{ARGWS_CONNECT_PLATFORM_API_IMAGE:-{spec['image']}}}\n"
            "    pull_policy: always\n"
            f"{spec['profile']}"
            "    restart: \"no\"\n"
            "    user: \"0:0\"\n"
            "    command:\n"
            "      - sh\n"
            "      - -ec\n"
            "      - |\n"
            "        set -eu\n"
            "        mkdir -p /prometheus-data /grafana-data\n"
            "        chown -R 65534:65534 /prometheus-data\n"
            "        chmod -R u+rwX,go-rwx /prometheus-data\n"
            "        chown -R 472:0 /grafana-data\n"
            "        chmod -R u+rwX,g+rwX,o-rwx /grafana-data\n"
            "    volumes:\n"
            "      - ${ARGWS_CONNECT_PLATFORM_PROMETHEUS_DATA_PATH:-./volumes/platform-prometheus}:/prometheus-data\n"
            "      - ${ARGWS_CONNECT_PLATFORM_GRAFANA_DATA_PATH:-./volumes/platform-grafana}:/grafana-data\n"
            f"    networks: [{network}]\n"
            "    security_opt: [\"no-new-privileges:true\"]\n"
            "    logging: *default-logging\n\n"
        )
        text = text.replace(marker, init_block + marker, 1)

    old_prom_depends = (
        "    depends_on:\n"
        f"      {api_service}: {{condition: service_healthy}}\n"
    )
    new_prom_depends = (
        "    depends_on:\n"
        f"      {init_service}: {{condition: service_completed_successfully}}\n"
        f"      {api_service}: {{condition: service_healthy}}\n"
    )
    if new_prom_depends not in text:
        if old_prom_depends not in text:
            raise RuntimeError(f"depends_on do Prometheus não encontrado em {path}")
        text = text.replace(old_prom_depends, new_prom_depends, 1)

    old_graf_depends = (
        "    depends_on:\n"
        f"      {prometheus_service}: {{condition: service_started}}\n"
    )
    new_graf_depends = (
        "    depends_on:\n"
        f"      {init_service}: {{condition: service_completed_successfully}}\n"
        f"      {prometheus_service}: {{condition: service_started}}\n"
    )
    if new_graf_depends not in text:
        if old_graf_depends not in text:
            raise RuntimeError(f"depends_on do Grafana não encontrado em {path}")
        text = text.replace(old_graf_depends, new_graf_depends, 1)

    if "./observability/" in text or "../../platform/infrastructure/" in text:
        raise RuntimeError(f"Dependência externa reapareceu em {path}")

    path.write_text(text, encoding="utf-8")

print("Permissões persistentes de Prometheus/Grafana corrigidas nas três stacks Platform.")
