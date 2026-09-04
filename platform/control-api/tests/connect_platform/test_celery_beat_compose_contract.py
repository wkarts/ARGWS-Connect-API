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


def test_celery_beat_bind_mount_is_prepared_before_scheduler() -> None:
    dockerfile = (ROOT / "platform/control-api/Dockerfile").read_text(encoding="utf-8")
    assert "useradd --create-home --uid 10001 appuser" in dockerfile
    assert "USER 10001:0" in dockerfile

    for relative_path, suffix in STACKS.items():
        text = (ROOT / relative_path).read_text(encoding="utf-8")
        init_service = f"platform-celery-init-{suffix}"
        scheduler_service = f"platform-scheduler-{suffix}"

        init_block = _service_block(text, init_service)
        assert 'user: "0:0"' in init_block
        assert 'restart: "no"' in init_block
        assert "chown -R 10001:0 /var/lib/celery" in init_block
        assert "chmod -R u+rwX,g+rwX,o-rwx /var/lib/celery" in init_block
        assert "ARGWS_CONNECT_PLATFORM_CELERY_DATA_PATH" in init_block

        scheduler_block = _service_block(text, scheduler_service)
        assert "--schedule=/var/lib/celery/celerybeat-schedule" in scheduler_block
        assert "ARGWS_CONNECT_PLATFORM_CELERY_DATA_PATH" in scheduler_block
        assert (
            f"platform-celery-init-{suffix}: {{condition: service_completed_successfully}}"
            in scheduler_block
        )
        assert f"platform-api-{suffix}: {{condition: service_healthy}}" in scheduler_block
