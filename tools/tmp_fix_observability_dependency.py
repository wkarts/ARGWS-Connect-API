from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STACKS = (
    ("deploy/platform/compose.yaml", "argws-connect-platform"),
    ("deploy/platform-develop/compose.yaml", "argws-connect-platform-develop"),
    ("deploy/platform-production/compose.yaml", "argws-connect-platform-production"),
)
SERVICE_RE = re.compile(r"(?m)^  ([^\s:#][^:\n]*):\s*$")


def service_block(text: str, service: str) -> tuple[int, int, str]:
    matches = list(SERVICE_RE.finditer(text))
    for index, match in enumerate(matches):
        if match.group(1) != service:
            continue
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else text.find("\nnetworks:\n", match.end())
        if end < 0:
            end = len(text)
        return start, end, text[start:end]
    raise RuntimeError(f"Serviço não encontrado: {service}")


for relative, suffix in STACKS:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    init = f"platform-observability-init-{suffix}"
    worker = f"platform-worker-{suffix}"
    prometheus = f"platform-prometheus-{suffix}"
    grafana = f"platform-grafana-{suffix}"
    init_line = f"      {init}: {{condition: service_completed_successfully}}\n"

    # Remove a dependência inserida por engano no worker.
    start, end, block = service_block(text, worker)
    if init_line in block:
        block = block.replace(init_line, "", 1)
        text = text[:start] + block + text[end:]

    # Prometheus precisa aguardar a correção de ownership antes de abrir /prometheus.
    start, end, block = service_block(text, prometheus)
    if init_line not in block:
        depends_marker = "    depends_on:\n"
        if depends_marker not in block:
            raise RuntimeError(f"depends_on ausente em {prometheus}")
        block = block.replace(depends_marker, depends_marker + init_line, 1)
        text = text[:start] + block + text[end:]

    # Valida o contrato no texto final antes de gravar.
    _, _, worker_block = service_block(text, worker)
    _, _, prometheus_block = service_block(text, prometheus)
    _, _, grafana_block = service_block(text, grafana)
    if init_line in worker_block:
        raise RuntimeError(f"{worker} não deve depender do init")
    if init_line not in prometheus_block:
        raise RuntimeError(f"{prometheus} deve depender do init")
    if init_line not in grafana_block:
        raise RuntimeError(f"{grafana} deve depender do init")

    path.write_text(text, encoding="utf-8")

print("Dependências do init de observabilidade corrigidas nas três stacks.")
