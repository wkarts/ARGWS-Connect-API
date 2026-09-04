from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STACKS = (
    ("deploy/platform/compose.yaml", "argws-connect-platform"),
    ("deploy/platform-develop/compose.yaml", "argws-connect-platform-develop"),
    ("deploy/platform-production/compose.yaml", "argws-connect-platform-production"),
)


def service_block(text: str, service: str) -> tuple[int, int, str]:
    marker = f"  {service}:\n"
    start = text.find(marker)
    if start < 0:
        raise RuntimeError(f"Serviço não encontrado: {service}")
    next_service = text.find("\n  ", start + len(marker))
    if next_service < 0:
        next_service = text.find("\nnetworks:\n", start + len(marker))
    if next_service < 0:
        next_service = len(text)
    return start, next_service, text[start:next_service]


for relative, suffix in STACKS:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    init = f"platform-observability-init-{suffix}"
    worker = f"platform-worker-{suffix}"
    prometheus = f"platform-prometheus-{suffix}"
    grafana = f"platform-grafana-{suffix}"

    # Remove a dependência inserida por engano no worker.
    start, end, block = service_block(text, worker)
    wrong_line = f"      {init}: {{condition: service_completed_successfully}}\n"
    if wrong_line in block:
        block = block.replace(wrong_line, "", 1)
        text = text[:start] + block + text[end:]

    # Prometheus precisa aguardar a correção de ownership antes de abrir /prometheus.
    start, end, block = service_block(text, prometheus)
    init_line = f"      {init}: {{condition: service_completed_successfully}}\n"
    if init_line not in block:
        depends_marker = "    depends_on:\n"
        if depends_marker not in block:
            raise RuntimeError(f"depends_on ausente em {prometheus}")
        block = block.replace(depends_marker, depends_marker + init_line, 1)
        text = text[:start] + block + text[end:]

    # Grafana também deve aguardar o mesmo init.
    _, _, grafana_block = service_block(text, grafana)
    if init_line not in grafana_block:
        raise RuntimeError(f"{grafana} não depende do init")

    path.write_text(text, encoding="utf-8")

print("Dependências do init de observabilidade corrigidas nas três stacks.")
