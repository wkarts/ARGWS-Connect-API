#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ComposeCase:
    name: str
    files: tuple[str, ...]
    project: str
    env_files: tuple[str, ...] = ()


def tracked_compose_files() -> set[str]:
    tracked = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True).splitlines()
    result: set[str] = set()
    for item in tracked:
        base = Path(item).name.lower()
        if not base.endswith((".yaml", ".yml")):
            continue
        if base.startswith("compose") or base.startswith("docker-compose"):
            result.add(item)
    return result


def render(case: ComposeCase) -> dict:
    env = os.environ.copy()
    env["COMPOSE_PROJECT_NAME"] = case.project
    env["ARGWS_CONNECT_NETWORK_NAME"] = f"{case.project}-net"

    cmd = ["docker", "compose"]
    for env_file in case.env_files:
        cmd.extend(["--env-file", env_file])
    cmd.extend(["--profile", "*"])
    for compose_file in case.files:
        cmd.extend(["-f", compose_file])
    cmd.extend(["config", "--format", "json"])

    return json.loads(subprocess.check_output(cmd, cwd=ROOT, env=env, text=True))


def assert_case(case: ComposeCase) -> None:
    cfg = render(case)
    assert cfg.get("name") == case.project, (
        f"{case.name}: project esperado {case.project}, obtido {cfg.get('name')}"
    )

    services = cfg.get("services", {})
    assert services, f"{case.name}: nenhum service renderizado"
    suffix = f"-{case.project}"
    for service_name, service_cfg in services.items():
        assert service_name.endswith(suffix), (
            f"{case.name}: service fora do padrão <recurso>-{case.project}: {service_name}"
        )
        assert service_cfg.get("container_name") == service_name, (
            f"{case.name}: container_name deve ser idêntico ao service: {service_name}"
        )

    networks = cfg.get("networks", {})
    network_names = {network.get("name") for network in networks.values()}
    expected_network = f"{case.project}-net"
    assert expected_network in network_names, (
        f"{case.name}: network esperada {expected_network}; obtidas {sorted(network_names)}"
    )


def main() -> int:
    cases = (
        ComposeCase("root-api", ("docker-compose.yaml",), "argws-connect-api", (".env.example",)),
        ComposeCase("root-api-dev", ("docker-compose.dev.yaml",), "argws-connect-api-dev", (".env.example",)),
        ComposeCase("production", ("deploy/production/compose.yaml",), "argws-connect-production", ("deploy/production/env.example",)),
        ComposeCase("develop", ("deploy/develop/compose.yaml",), "argws-connect-develop", ("deploy/develop/env.example",)),
        ComposeCase("develop-platform", ("deploy/develop/compose.yaml", "deploy/develop/compose.platform.yaml"), "argws-connect-develop", ("deploy/develop/env.example", "deploy/develop/platform.env.example")),
        ComposeCase("canonical", ("deploy/canonical/compose.yaml",), "argws-connect-canonical", ("deploy/canonical/env.example",)),
        ComposeCase("homologation", ("deploy/homologation/compose.yaml",), "argws-connect-homologation", ("deploy/homologation/env.example",)),
        ComposeCase("cloudpanel", ("deploy/cloudpanel/docker-compose.yml",), "argws-connect-cloudpanel", ("deploy/cloudpanel/env.example",)),
        ComposeCase("dockge", ("deploy/dockge/compose.yaml",), "argws-connect-dockge", ("deploy/dockge/env.example",)),
        ComposeCase("docs", ("deploy/docs/compose.yaml",), "argws-connect-docs", ("deploy/docs/env.example",)),
        ComposeCase("docs-develop", ("deploy/docs-develop/compose.yaml",), "argws-connect-docs-develop", ("deploy/docs-develop/env.example",)),
        ComposeCase("platform", ("deploy/platform/compose.yaml",), "argws-connect-platform", ("deploy/platform/env.example",)),
        ComposeCase("platform-local-build", ("deploy/platform/compose.yaml", "deploy/platform/compose.local-build.yaml"), "argws-connect-platform", ("deploy/platform/env.example",)),
        ComposeCase("aux-postgres", ("Docker/postgres/docker-compose.yaml",), "argws-connect-postgres"),
        ComposeCase("aux-redis", ("Docker/redis/docker-compose.yaml",), "argws-connect-redis"),
        ComposeCase("aux-rabbitmq", ("Docker/rabbitmq/docker-compose.yaml",), "argws-connect-rabbitmq"),
        ComposeCase("aux-minio", ("Docker/minio/docker-compose.yaml",), "argws-connect-minio"),
        ComposeCase("aux-mysql", ("Docker/mysql/docker-compose.yaml",), "argws-connect-mysql"),
        ComposeCase("aux-kafka", ("Docker/kafka/docker-compose.yaml",), "argws-connect-kafka"),
    )

    covered = {compose_file for case in cases for compose_file in case.files}
    discovered = tracked_compose_files()
    missing = discovered - covered
    stale = covered - discovered
    assert not missing, f"Compose(s) sem contrato de nomenclatura: {sorted(missing)}"
    assert not stale, f"Contrato referencia Compose(s) inexistente(s): {sorted(stale)}"

    for case in cases:
        assert_case(case)
        print(f"OK {case.name}: {case.project}")

    print(f"Deployment naming integrity PASS ({len(discovered)} Compose files / {len(cases)} render cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
