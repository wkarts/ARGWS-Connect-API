from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
STACKS = {
    "deploy/platform/compose.yaml": "argws-connect-platform",
    "deploy/platform-develop/compose.yaml": "argws-connect-platform-develop",
    "deploy/platform-production/compose.yaml": "argws-connect-platform-production",
}


def _service_block(text: str, service: str) -> str:
    match = re.search(
        rf"(?ms)^  {re.escape(service)}:\n.*?(?=^  [A-Za-z0-9_-]+:\n|\Z)",
        text,
    )
    assert match is not None, f"Serviço ausente: {service}"
    return match.group(0)


def test_celery_beat_uses_container_writable_ephemeral_schedule() -> None:
    """O Beat não precisa persistir shelve; o schedule é recriado da configuração.

    O bind mount histórico em /var/lib/celery gerava PermissionError quando o
    container non-root iniciava sobre diretório criado pelo host/root.
    """
    dockerfile = (ROOT / "platform/control-api/Dockerfile").read_text(encoding="utf-8")
    assert "useradd --create-home --uid 10001 appuser" in dockerfile
    assert "USER 10001:0" in dockerfile

    for relative_path, suffix in STACKS.items():
        text = (ROOT / relative_path).read_text(encoding="utf-8")
        scheduler_service = f"platform-scheduler-{suffix}"
        scheduler_block = _service_block(text, scheduler_service)

        assert "--schedule=/tmp/celerybeat-schedule" in scheduler_block
        assert "--pidfile=/tmp/celerybeat.pid" in scheduler_block
        assert "/var/lib/celery" not in scheduler_block
        assert "ARGWS_CONNECT_PLATFORM_CELERY_DATA_PATH" not in scheduler_block
        assert f"platform-api-{suffix}: {{condition: service_healthy}}" in scheduler_block

        # O antigo init/chown não deve voltar: ele mascarava o problema de
        # ownership do bind mount e adicionava estado desnecessário ao Beat.
        assert f"platform-celery-init-{suffix}:" not in text
