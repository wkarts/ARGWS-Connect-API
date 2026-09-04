from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STACKS = (
    "deploy/platform/compose.yaml",
    "deploy/platform-develop/compose.yaml",
    "deploy/platform-production/compose.yaml",
)

PROMETHEUS_OLD = '''    volumes:\n      - ../../platform/infrastructure/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro\n      - ${ARGWS_CONNECT_PLATFORM_PROMETHEUS_DATA_PATH:-./volumes/platform-prometheus}:/prometheus\n'''
PROMETHEUS_NEW = '''    configs:\n      - source: platform-prometheus-config\n        target: /etc/prometheus/prometheus.yml\n    volumes:\n      - ${ARGWS_CONNECT_PLATFORM_PROMETHEUS_DATA_PATH:-./volumes/platform-prometheus}:/prometheus\n'''

GRAFANA_OLD = '''    volumes:\n      - ${ARGWS_CONNECT_PLATFORM_GRAFANA_DATA_PATH:-./volumes/platform-grafana}:/var/lib/grafana\n      - ../../platform/infrastructure/grafana/provisioning:/etc/grafana/provisioning:ro\n'''
GRAFANA_NEW = '''    configs:\n      - source: platform-grafana-prometheus-datasource\n        target: /etc/grafana/provisioning/datasources/prometheus.yml\n      - source: platform-grafana-dashboard-provider\n        target: /etc/grafana/provisioning/dashboards/dashboards.yml\n    volumes:\n      - ${ARGWS_CONNECT_PLATFORM_GRAFANA_DATA_PATH:-./volumes/platform-grafana}:/var/lib/grafana\n'''

CONFIGS_BLOCK = '''configs:\n  platform-prometheus-config:\n    content: |\n      global:\n        scrape_interval: 30s\n        evaluation_interval: 30s\n      scrape_configs:\n        - job_name: connect-api\n          metrics_path: /metrics\n          static_configs:\n            - targets: ["connect-platform-api:8000"]\n\n  platform-grafana-prometheus-datasource:\n    content: |\n      apiVersion: 1\n      datasources:\n        - name: Prometheus\n          type: prometheus\n          access: proxy\n          url: http://connect-prometheus:9090\n          isDefault: true\n          editable: false\n\n  platform-grafana-dashboard-provider:\n    content: |\n      apiVersion: 1\n      providers:\n        - name: Connect|API Platform\n          folder: Connect|API Platform\n          type: file\n          disableDeletion: false\n          editable: true\n          options:\n            path: /var/lib/grafana/dashboards\n\n'''

for relative_path in STACKS:
    path = ROOT / relative_path
    text = path.read_text(encoding="utf-8")

    if PROMETHEUS_OLD in text:
        text = text.replace(PROMETHEUS_OLD, PROMETHEUS_NEW, 1)
    elif "source: platform-prometheus-config" not in text:
        raise RuntimeError(f"Bloco Prometheus não localizado em {relative_path}")

    if GRAFANA_OLD in text:
        text = text.replace(GRAFANA_OLD, GRAFANA_NEW, 1)
    elif "source: platform-grafana-prometheus-datasource" not in text:
        raise RuntimeError(f"Bloco Grafana não localizado em {relative_path}")

    if "\nconfigs:\n  platform-prometheus-config:\n" not in text:
        marker = "\nnetworks:\n"
        if text.count(marker) != 1:
            raise RuntimeError(f"Marcador networks inesperado em {relative_path}")
        text = text.replace(marker, "\n" + CONFIGS_BLOCK + "networks:\n", 1)

    if "../../platform/infrastructure/" in text:
        raise RuntimeError(f"Referência externa de infraestrutura permaneceu em {relative_path}")

    path.write_text(text, encoding="utf-8")

print("Configuração de Prometheus/Grafana incorporada às três stacks da Platform.")
