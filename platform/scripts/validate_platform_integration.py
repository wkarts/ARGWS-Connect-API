#!/usr/bin/env python3
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
ERRORS: list[str] = []
WARNINGS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def main() -> int:
    required = [
        "VERSION",
        "package.json",
        "platform/control-api/Dockerfile",
        "platform/control-api/app/main.py",
        "platform/control-api/app/services/connect_engine.py",
        "platform/control-api/app/api/routes/tenant_engine.py",
        "platform/web/Dockerfile",
        "platform/web/src/router/index.ts",
        "platform/web/src/pages/ConnectInstancesPage.vue",
        "platform/web/src/pages/ConnectTemplatesPage.vue",
        "platform/web/src/pages/ConnectIntegrationsPage.vue",
        "platform/web/src/pages/ConnectMicroAppsPage.vue",
        "platform/web/src/pages/ConnectAutomationsPage.vue",
        "platform/gateway/Dockerfile",
        "deploy/platform/compose.yaml",
        "deploy/platform/env.example",
        "docs/guides/platform-runtime-modes.md",
        "manager/DEPRECATED.md",
    ]
    for item in required:
        if not (ROOT / item).is_file():
            fail(f"missing: {item}")

    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if package.get("version") != version:
        fail(f"package.json version {package.get('version')} != VERSION {version}")
    pyproject = (ROOT / "platform/control-api/pyproject.toml").read_text(encoding="utf-8")
    if f'version = "{version}"' not in pyproject:
        fail("Platform pyproject version is not synchronized with root VERSION")
    platform_env = (ROOT / "deploy/platform/env.example").read_text(encoding="utf-8")
    if f"CONNECT_API_VERSION={version}" not in platform_env:
        fail("deploy/platform/env.example is not synchronized with root VERSION")

    root_router = (ROOT / "src/api/routes/index.router.ts").read_text(encoding="utf-8")
    if "ViewsRouter" in root_router or ".use('/manager'" in root_router or "manager/dist" in root_router:
        fail("legacy Manager is still served by the Engine")
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    if re.search(r"COPY .*manager", dockerfile):
        fail("legacy Manager is still copied into the Engine image")

    for path in (ROOT / "platform/control-api/app").rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        try:
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:
            fail(f"Python syntax: {path.relative_to(ROOT)}:{exc.lineno}: {exc.msg}")

    for path in (ROOT / ".github/workflows").glob("*.yml"):
        try:
            yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            fail(f"Workflow YAML: {path.name}: {exc}")

    release_manifest = json.loads((ROOT / "RELEASE-MANIFEST.json").read_text(encoding="utf-8"))
    images = set(release_manifest.get("distribution", {}).get("application_images", []))
    expected_images = {
        "ghcr.io/wkarts/argws-connect-api",
        "ghcr.io/wkarts/argws-connect-docs",
        "ghcr.io/wkarts/argws-connect-platform-api",
        "ghcr.io/wkarts/argws-connect-platform-web",
        "ghcr.io/wkarts/argws-connect-platform-gateway",
    }
    if not expected_images.issubset(images):
        fail(f"RELEASE-MANIFEST missing application images: {sorted(expected_images - images)}")

    compose = (ROOT / "deploy/platform/compose.yaml").read_text(encoding="utf-8")
    for service in ("api-argws-connect-platform", "docs-argws-connect-platform", "platform-api-argws-connect-platform", "platform-web-argws-connect-platform", "platform-gateway-argws-connect-platform"):
        if f"  {service}:" not in compose:
            fail(f"platform compose missing service {service}")
    if "profiles: [platform]" not in compose or "profiles: [docs, platform]" not in compose:
        fail("platform compose does not expose docs/platform profiles")

    print(f"Connect|API Platform integration validation: {'PASS' if not ERRORS else 'FAIL'}")
    print(f"Version: {version}")
    if WARNINGS:
        print("Warnings:")
        for item in WARNINGS:
            print(f"- {item}")
    if ERRORS:
        print("Errors:")
        for item in ERRORS:
            print(f"- {item}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
