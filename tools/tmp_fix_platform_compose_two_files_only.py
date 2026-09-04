from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STACKS = (
    "deploy/platform",
    "deploy/platform-develop",
    "deploy/platform-production",
)

PROM_OLD = '''    command:\n      - --config.file=/etc/prometheus/prometheus.yml\n      - --storage.tsdb.path=/prometheus\n      - --storage.tsdb.retention.time=${PROMETHEUS_RETENTION:-30d}\n    configs:\n      - source: platform-prometheus-config\n        target: /etc/prometheus/prometheus.yml\n'''

PROM_NEW = '''    entrypoint: ["/bin/sh", "-ec"]\n    command:\n      - |\n        cat > /tmp/prometheus.yml <<'EOF'\n        global:\n          scrape_interval: 30s\n          evaluation_interval: 30s\n\n        scrape_configs:\n          - job_name: connect-api\n            metrics_path: /metrics\n            static_configs:\n              - targets: ["connect-platform-api:8000"]\n        EOF\n        exec /bin/prometheus \\\n          --config.file=/tmp/prometheus.yml \\\n          --storage.tsdb.path=/prometheus \\\n          --storage.tsdb.retention.time="${PROMETHEUS_RETENTION:-30d}"\n'''

GRAFANA_CONFIGS_OLD = '''    configs:\n      - source: platform-grafana-prometheus-datasource\n        target: /etc/grafana/provisioning/datasources/prometheus.yml\n      - source: platform-grafana-dashboard-provider\n        target: /etc/grafana/provisioning/dashboards/dashboards.yml\n'''

GRAFANA_INLINE = '''    entrypoint: ["/bin/sh", "-ec"]\n    command:\n      - |\n        mkdir -p /tmp/grafana-provisioning/datasources /tmp/grafana-provisioning/dashboards\n        cat > /tmp/grafana-provisioning/datasources/prometheus.yml <<'EOF'\n        apiVersion: 1\n        datasources:\n          - name: Prometheus\n            type: prometheus\n            access: proxy\n            url: http://connect-prometheus:9090\n            isDefault: true\n            editable: false\n        EOF\n        cat > /tmp/grafana-provisioning/dashboards/dashboards.yml <<'EOF'\n        apiVersion: 1\n        providers:\n          - name: Connect|API Platform\n            folder: Connect|API Platform\n            type: file\n            disableDeletion: false\n            editable: true\n            options:\n              path: /var/lib/grafana/dashboards\n        EOF\n        exec /run.sh\n'''

TOP_CONFIGS = '''configs:\n  platform-prometheus-config:\n    file: ./observability/prometheus/prometheus.yml\n\n  platform-grafana-prometheus-datasource:\n    file: ./observability/grafana/provisioning/datasources/prometheus.yml\n\n  platform-grafana-dashboard-provider:\n    file: ./observability/grafana/provisioning/dashboards/dashboards.yml\n\n'''

for stack in STACKS:
    compose = ROOT / stack / "compose.yaml"
    text = compose.read_text(encoding="utf-8")

    if PROM_OLD not in text:
        raise RuntimeError(f"Bloco Prometheus esperado não encontrado em {compose}")
    text = text.replace(PROM_OLD, PROM_NEW, 1)

    grafana_env_marker = '      GF_USERS_ALLOW_SIGN_UP: "false"\n'
    if grafana_env_marker not in text:
        raise RuntimeError(f"Environment Grafana não encontrado em {compose}")
    text = text.replace(
        grafana_env_marker,
        grafana_env_marker + '      GF_PATHS_PROVISIONING: /tmp/grafana-provisioning\n',
        1,
    )

    if GRAFANA_CONFIGS_OLD not in text:
        raise RuntimeError(f"Bloco configs Grafana esperado não encontrado em {compose}")
    text = text.replace(GRAFANA_CONFIGS_OLD, GRAFANA_INLINE, 1)

    if TOP_CONFIGS not in text:
        raise RuntimeError(f"Bloco configs top-level esperado não encontrado em {compose}")
    text = text.replace(TOP_CONFIGS, "", 1)

    forbidden = (
        "configs:",
        "./observability/",
        "../../platform/infrastructure/",
        "source: platform-prometheus-config",
        "source: platform-grafana-prometheus-datasource",
    )
    for token in forbidden:
        if token in text:
            raise RuntimeError(f"Dependência externa/config permaneceu em {compose}: {token}")

    compose.write_text(text, encoding="utf-8")

    obs = ROOT / stack / "observability"
    if obs.exists():
        for file in sorted(obs.rglob("*"), reverse=True):
            if file.is_file() or file.is_symlink():
                file.unlink()
            elif file.is_dir():
                file.rmdir()
        obs.rmdir()

print("Stacks Platform ajustadas para runtime com apenas compose.yaml + .env.")
