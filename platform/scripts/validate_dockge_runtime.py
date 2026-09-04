#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import yaml

REPO = Path(__file__).resolve().parents[2]
COMPOSE = REPO / "deploy/dockge/compose.yaml"
ENV = REPO / "deploy/dockge/env.example"
PROJECT = "argws-connect-dockge"


def fail(message: str) -> None:
    raise SystemExit(f"[ERRO] {message}")


data = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
if not isinstance(data, dict) or not isinstance(data.get("services"), dict):
    fail("deploy/dockge/compose.yaml inválido")
services: dict = data["services"]

required = {
    f"api-{PROJECT}", f"docs-{PROJECT}", f"postgres-{PROJECT}",
    f"redis-{PROJECT}", f"rabbitmq-{PROJECT}", f"minio-{PROJECT}",
}
missing = sorted(required - set(services))
if missing:
    fail(f"serviços core ausentes: {missing}")

for name, service in services.items():
    if not isinstance(service, dict):
        continue
    if service.get("container_name") != name:
        fail(f"container_name divergente: {name}")
    if "build" in service:
        fail(f"Dockge oficial não deve exigir build local: {name}")
    if service.get("image") and service.get("pull_policy") != "always":
        fail(f"{name} deve usar pull_policy=always")

publishers = {name for name, service in services.items() if isinstance(service, dict) and service.get("ports")}
expected_publishers = {f"api-{PROJECT}", f"docs-{PROJECT}"}
if publishers != expected_publishers:
    fail(f"portas Dockge divergentes: {sorted(publishers)}")

for logical in ("postgres", "redis", "rabbitmq", "minio"):
    if (services[f"{logical}-{PROJECT}"].get("ports")):
        fail(f"{logical} não pode publicar porta no host")

text = ENV.read_text(encoding="utf-8")
for token in (
    "COMPOSE_PROJECT_NAME=argws-connect-dockge",
    "ARGWS_CONNECT_NETWORK_NAME=argws-connect-dockge-net",
    "ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:latest",
    "ARGWS_CONNECT_DOCS_IMAGE=ghcr.io/wkarts/argws-connect-docs:latest",
):
    if token not in text:
        fail(f"env.example Dockge sem contrato: {token}")

print("Dockge runtime: PASS")
print("- deployment clássico preservado")
print("- image-only / pull_policy=always")
print("- somente API e DOCs publicam portas")
print("- PostgreSQL/Redis/RabbitMQ/MinIO internos")
