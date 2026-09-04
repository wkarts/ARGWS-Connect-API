from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STACKS = (
    "deploy/platform",
    "deploy/platform-develop",
    "deploy/platform-production",
)

OLD_CONFIGS = '''configs:\n  platform-prometheus-config:\n    content: |\n      global:\n        scrape_interval: 30s\n        evaluation_interval: 30s\n      scrape_configs:\n        - job_name: connect-api\n          metrics_path: /metrics\n          static_configs:\n            - targets: [\"connect-platform-api:8000\"]\n\n  platform-grafana-prometheus-datasource:\n    content: |\n      apiVersion: 1\n      datasources:\n        - name: Prometheus\n          type: prometheus\n          access: proxy\n          url: http://connect-prometheus:9090\n          isDefault: true\n          editable: false\n\n  platform-grafana-dashboard-provider:\n    content: |\n      apiVersion: 1\n      providers:\n        - name: Connect|API Platform\n          folder: Connect|API Platform\n          type: file\n          disableDeletion: false\n          editable: true\n          options:\n            path: /var/lib/grafana/dashboards\n'''

NEW_CONFIGS = '''configs:\n  platform-prometheus-config:\n    file: ./observability/prometheus/prometheus.yml\n\n  platform-grafana-prometheus-datasource:\n    file: ./observability/grafana/provisioning/datasources/prometheus.yml\n\n  platform-grafana-dashboard-provider:\n    file: ./observability/grafana/provisioning/dashboards/dashboards.yml\n'''

PROMETHEUS = '''global:\n  scrape_interval: 30s\n  evaluation_interval: 30s\n\nscrape_configs:\n  - job_name: connect-api\n    metrics_path: /metrics\n    static_configs:\n      - targets: [\"connect-platform-api:8000\"]\n'''

GRAFANA_DATASOURCE = '''apiVersion: 1\ndatasources:\n  - name: Prometheus\n    type: prometheus\n    access: proxy\n    url: http://connect-prometheus:9090\n    isDefault: true\n    editable: false\n'''

GRAFANA_DASHBOARDS = '''apiVersion: 1\nproviders:\n  - name: Connect|API Platform\n    folder: Connect|API Platform\n    type: file\n    disableDeletion: false\n    editable: true\n    options:\n      path: /var/lib/grafana/dashboards\n'''

for stack in STACKS:
    compose = ROOT / stack / "compose.yaml"
    text = compose.read_text(encoding="utf-8")

    if OLD_CONFIGS in text:
        text = text.replace(OLD_CONFIGS, NEW_CONFIGS, 1)
    elif NEW_CONFIGS not in text:
        raise RuntimeError(f"Bloco configs esperado não encontrado em {compose}")

    if "content: |" in text[text.find("\nconfigs:\n"):]:
        raise RuntimeError(f"configs.content permaneceu em {compose}")

    compose.write_text(text, encoding="utf-8")

    files = {
        "observability/prometheus/prometheus.yml": PROMETHEUS,
        "observability/grafana/provisioning/datasources/prometheus.yml": GRAFANA_DATASOURCE,
        "observability/grafana/provisioning/dashboards/dashboards.yml": GRAFANA_DASHBOARDS,
    }
    for relative, payload in files.items():
        target = ROOT / stack / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(payload, encoding="utf-8")

print("Compose configs convertidos de content para file nas três stacks da Platform.")
