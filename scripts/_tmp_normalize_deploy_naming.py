from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESOURCES = ("api", "docs", "postgres", "redis", "rabbitmq", "minio", "nats", "zookeeper", "kafka", "mysql")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def rename_service(text: str, old: str, new: str) -> str:
    text = text.replace(f"\n  {old}:\n", f"\n  {new}:\n")
    text = text.replace(f"\n      {old}:\n", f"\n      {new}:\n")
    text = text.replace(f"\n      {old}: {{condition:", f"\n      {new}: {{condition:")
    text = text.replace(f"\n      - {old}\n", f"\n      - {new}\n")
    text = text.replace(f"depends_on: [{old}]", f"depends_on: [{new}]")
    return text


def service_bounds(text: str, service: str) -> tuple[int, int]:
    marker = f"\n  {service}:\n"
    start = text.find(marker)
    if start < 0:
        raise RuntimeError(f"service not found: {service}")
    start += 1
    search_from = start + len(f"  {service}:\n")
    section_end = text.find("\nnetworks:\n", search_from)
    if section_end < 0:
        section_end = len(text)
    match = re.search(r"(?m)^  [a-z0-9][a-z0-9_-]*:\s*$", text[search_from:section_end])
    end = search_from + match.start() if match else section_end
    return start, end


def ensure_container_name(text: str, service: str, old_container: str | None = None) -> str:
    start, end = service_bounds(text, service)
    block = text[start:end]
    match = re.search(r"(?m)^    container_name:\s*([^\s#]+)\s*$", block)
    if match:
        old_line = match.group(0)
        block = block.replace(old_line, f"    container_name: {service}", 1)
        return text[:start] + block + text[end:]
    marker = f"  {service}:\n"
    block = block.replace(marker, marker + f"    container_name: {service}\n", 1)
    return text[:start] + block + text[end:]


def ensure_aliases(text: str, service: str, network: str, aliases: list[str]) -> str:
    start, end = service_bounds(text, service)
    block = text[start:end]
    aliases_text = ", ".join(aliases)
    list_form = f"    networks: [{network}]"
    map_form = f"    networks:\n      {network}:"
    if list_form in block:
        block = block.replace(list_form, f"    networks:\n      {network}:\n        aliases: [{aliases_text}]", 1)
    elif map_form in block:
        match = re.search(r"(?m)^        aliases:\s*\[([^\]]*)\]\s*$", block)
        if match:
            existing = [item.strip() for item in match.group(1).split(",") if item.strip()]
            merged = existing + [item for item in aliases if item not in existing]
            block = block[: match.start()] + f"        aliases: [{', '.join(merged)}]" + block[match.end() :]
        else:
            block = block.replace(map_form, map_form + f"\n        aliases: [{aliases_text}]", 1)
    else:
        block = block.rstrip() + f"\n    networks:\n      {network}:\n        aliases: [{aliases_text}]\n"
    return text[:start] + block + text[end:]


def normalize_generic(path: str, deployment: str) -> None:
    network = f"argws-connect-{deployment}-net"
    text = read(path)
    text = text.replace("argws-connect-net", network)
    text = text.replace("argws-connect-homolog-net", network)
    for old in RESOURCES:
        if f"\n  {old}:\n" not in text:
            continue
        new = f"{old}-argws-connect-{deployment}"
        text = rename_service(text, old, new)
        text = ensure_container_name(text, new)
    write(path, text)


def normalize_root() -> None:
    text = read("docker-compose.yaml").replace("argws-connect-net", "argws-connect-api-net")
    for old in RESOURCES:
        if f"\n  {old}:\n" not in text:
            continue
        new = f"{old}-argws-connect-api"
        text = rename_service(text, old, new)
        text = ensure_container_name(text, new)
    write("docker-compose.yaml", text)
    write(
        ".env.example",
        read(".env.example").replace("ARGWS_CONNECT_NETWORK_NAME=argws-connect-net", "ARGWS_CONNECT_NETWORK_NAME=argws-connect-api-net"),
    )


def normalize_platform() -> None:
    mapping = {
        "connect-engine": "api-argws-connect-platform",
        "connect-docs": "docs-argws-connect-platform",
        "connect-engine-postgres": "postgres-argws-connect-platform",
        "connect-redis": "redis-argws-connect-platform",
        "connect-rabbitmq": "rabbitmq-argws-connect-platform",
        "connect-minio": "minio-argws-connect-platform",
        "connect-platform-postgres": "platform-postgres-argws-connect-platform",
        "connect-platform-migrate": "platform-migrate-argws-connect-platform",
        "connect-platform-migrate-tenants": "platform-migrate-tenants-argws-connect-platform",
        "connect-platform-bootstrap": "platform-bootstrap-argws-connect-platform",
        "connect-platform-api": "platform-api-argws-connect-platform",
        "connect-platform-worker": "platform-worker-argws-connect-platform",
        "connect-platform-scheduler": "platform-scheduler-argws-connect-platform",
        "connect-platform-web": "platform-web-argws-connect-platform",
        "connect-gateway": "platform-gateway-argws-connect-platform",
    }
    text = read("deploy/platform/compose.yaml").replace("connect-internal", "argws-connect-platform-net")
    # Longest names first avoids matching connect-platform-migrate inside migrate-tenants.
    for old in sorted(mapping, key=len, reverse=True):
        text = rename_service(text, old, mapping[old])
    for service in mapping.values():
        text = ensure_container_name(text, service)
    aliases = {
        mapping["connect-engine"]: ["connect-engine", "argws-connect-api"],
        mapping["connect-docs"]: ["connect-docs"],
        mapping["connect-engine-postgres"]: ["connect-engine-postgres", "argws-connect-postgres"],
        mapping["connect-redis"]: ["connect-redis", "argws-connect-redis"],
        mapping["connect-rabbitmq"]: ["connect-rabbitmq", "argws-connect-rabbitmq"],
        mapping["connect-minio"]: ["connect-minio", "argws-connect-minio"],
        mapping["connect-platform-postgres"]: ["connect-platform-postgres"],
        mapping["connect-platform-api"]: ["connect-platform-api"],
        mapping["connect-platform-web"]: ["connect-platform-web"],
    }
    for service, names in aliases.items():
        text = ensure_aliases(text, service, "argws-connect-platform-net", names)
    write("deploy/platform/compose.yaml", text)

    local_build = read("deploy/platform/compose.local-build.yaml")
    for old in sorted(("connect-engine", "connect-docs", "connect-platform-api", "connect-platform-web", "connect-gateway"), key=len, reverse=True):
        local_build = rename_service(local_build, old, mapping[old])
    write("deploy/platform/compose.local-build.yaml", local_build)


def normalize_develop_overlay() -> None:
    mapping = {
        "connect-platform-postgres": "platform-postgres-argws-connect-develop",
        "connect-platform-migrate": "platform-migrate-argws-connect-develop",
        "connect-platform-migrate-tenants": "platform-migrate-tenants-argws-connect-develop",
        "connect-platform-bootstrap": "platform-bootstrap-argws-connect-develop",
        "connect-platform-api": "platform-api-argws-connect-develop",
        "connect-platform-worker": "platform-worker-argws-connect-develop",
        "connect-platform-scheduler": "platform-scheduler-argws-connect-develop",
        "connect-platform-web": "platform-web-argws-connect-develop",
        "connect-gateway": "platform-gateway-argws-connect-develop",
    }
    text = read("deploy/develop/compose.platform.yaml")
    for old in sorted(mapping, key=len, reverse=True):
        text = rename_service(text, old, mapping[old])
    for service in mapping.values():
        text = ensure_container_name(text, service)
    for service, aliases in {
        mapping["connect-platform-postgres"]: ["connect-platform-postgres"],
        mapping["connect-platform-api"]: ["connect-platform-api"],
        mapping["connect-platform-web"]: ["connect-platform-web"],
    }.items():
        text = ensure_aliases(text, service, "argws-connect-develop-net", aliases)
    write("deploy/develop/compose.platform.yaml", text)


def update_contracts() -> None:
    tests = read("platform/control-api/tests/connect_platform/test_integrated_foundation.py")
    replacements = {
        '"connect-engine:"': '"api-argws-connect-platform:"',
        '"connect-platform-api:"': '"platform-api-argws-connect-platform:"',
        '"connect-platform-web:"': '"platform-web-argws-connect-platform:"',
        '"connect-gateway:"': '"platform-gateway-argws-connect-platform:"',
        '"connect-platform-postgres:"': '"platform-postgres-argws-connect-develop:"',
    }
    for old, new in replacements.items():
        tests = tests.replace(old, new)
    write("platform/control-api/tests/connect_platform/test_integrated_foundation.py", tests)

    validator = read("platform/scripts/validate_platform_integration.py").replace(
        '("connect-engine", "connect-docs", "connect-platform-api", "connect-platform-web", "connect-gateway")',
        '("api-argws-connect-platform", "docs-argws-connect-platform", "platform-api-argws-connect-platform", "platform-web-argws-connect-platform", "platform-gateway-argws-connect-platform")',
    )
    write("platform/scripts/validate_platform_integration.py", validator)

    guide = read("docs/guides/platform-runtime-modes.md")
    if "### Convenção dos services" not in guide:
        guide += """

### Convenção dos services

Todo service de um deployment independente segue `recurso-argws-connect-deployment`, e o `container_name` deve ser idêntico ao service. Exemplos: `api-argws-connect-develop`, `docs-argws-connect-platform`, `platform-api-argws-connect-platform`. Aliases internos estáveis (`connect-engine`, `connect-platform-api`, `argws-connect-postgres` etc.) podem existir para desacoplar a comunicação interna da nomenclatura física.

No overlay `deploy/develop/compose.platform.yaml`, os serviços já existentes mantêm seus nomes `*-argws-connect-develop` e os novos componentes usam `platform-*-argws-connect-develop`.
"""
    write("docs/guides/platform-runtime-modes.md", guide)

    deploy_readme = read("deploy/README.md")
    if "## Convenção canônica de nomenclatura" not in deploy_readme:
        deploy_readme += """

## Convenção canônica de nomenclatura

- project: `argws-connect-<deployment>`
- network: `argws-connect-<deployment>-net`
- service: `<recurso>-argws-connect-<deployment>`
- `container_name`: idêntico ao service
- overlays não criam novo project name; herdam a stack-base.
"""
    write("deploy/README.md", deploy_readme)


def main() -> None:
    normalize_root()
    normalize_generic("deploy/cloudpanel/docker-compose.yml", "cloudpanel")
    normalize_generic("deploy/dockge/compose.yaml", "dockge")
    normalize_generic("deploy/homologation/compose.yaml", "homologation")
    write("deploy/docs/compose.yaml", read("deploy/docs/compose.yaml").replace("docs-argws-connect-standalone", "docs-argws-connect-docs"))
    write("deploy/docs-develop/compose.yaml", read("deploy/docs-develop/compose.yaml").replace("docs-argws-connect-standalone-develop", "docs-argws-connect-docs-develop"))
    normalize_platform()
    normalize_develop_overlay()
    update_contracts()


if __name__ == "__main__":
    main()
