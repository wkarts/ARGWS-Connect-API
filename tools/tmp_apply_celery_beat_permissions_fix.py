from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

STACKS = {
    "deploy/platform/compose.yaml": "argws-connect-platform",
    "deploy/platform-develop/compose.yaml": "argws-connect-platform-develop",
    "deploy/platform-production/compose.yaml": "argws-connect-platform-production",
}

for relative_path, suffix in STACKS.items():
    path = ROOT / relative_path
    text = path.read_text(encoding="utf-8")

    scheduler_marker = f"  platform-scheduler-{suffix}:\n"
    if text.count(scheduler_marker) != 1:
        raise RuntimeError(f"Marcador do scheduler inesperado em {relative_path}")

    init_service = f'''  platform-celery-init-{suffix}:\n    container_name: platform-celery-init-{suffix}\n    <<: *platform-app\n    user: "0:0"\n    restart: "no"\n    command:\n      - sh\n      - -ec\n      - |\n        mkdir -p /var/lib/celery\n        chown -R 10001:0 /var/lib/celery\n        chmod -R u+rwX,g+rwX,o-rwx /var/lib/celery\n    volumes:\n      - ${{ARGWS_CONNECT_PLATFORM_CELERY_DATA_PATH:-./volumes/platform-celery}}:/var/lib/celery\n\n'''

    if f"  platform-celery-init-{suffix}:\n" not in text:
        text = text.replace(scheduler_marker, init_service + scheduler_marker, 1)

    api_dependency = f"      platform-api-{suffix}: {{condition: service_healthy}}\n"
    scheduler_start = text.index(scheduler_marker)
    scheduler_end = text.find("\n  ", scheduler_start + len(scheduler_marker))
    if scheduler_end == -1:
        scheduler_end = len(text)
    scheduler_block = text[scheduler_start:scheduler_end]

    init_dependency = f"      platform-celery-init-{suffix}: {{condition: service_completed_successfully}}\n"
    if init_dependency not in scheduler_block:
        if api_dependency not in scheduler_block:
            raise RuntimeError(f"Dependência da Platform API não localizada no scheduler de {relative_path}")
        scheduler_block = scheduler_block.replace(api_dependency, init_dependency + api_dependency, 1)
        text = text[:scheduler_start] + scheduler_block + text[scheduler_end:]

    path.write_text(text, encoding="utf-8")

print("Celery Beat bind-mount permission fix aplicado nas três stacks.")
