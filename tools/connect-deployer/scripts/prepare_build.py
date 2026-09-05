"""Create build metadata; does not change the application version or installer."""
from __future__ import annotations

import ast
import hashlib
import json
import os
import platform
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def find_repository(start: Path = ROOT) -> Path:
    for directory in (start, *start.parents):
        if (directory / "VERSION").is_file() and (directory / "install-connect.py").is_file():
            return directory
    raise ValueError("Use o projeto completo ARGWS-Connect-API para identificar versão e payload canônico.")


def literal_version(path: Path, name: str = "VERSION") -> str:
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and any(isinstance(x, ast.Name) and x.id == name for x in node.targets):
            return str(ast.literal_eval(node.value))
    raise ValueError(f"Versão não encontrada em {path.name}.")


def target_name() -> str:
    system = {"Windows": "windows", "Linux": "linux", "Darwin": "macos"}.get(platform.system())
    arch = {"AMD64": "x86_64", "x86_64": "x86_64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine())
    if system is None or arch is None:
        raise ValueError("Sistema/arquitetura de build não suportado.")
    return f"{system}-{arch}"


def prepare() -> dict:
    repo = find_repository()
    version = (repo / "VERSION").read_text().strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("VERSION canônica inválida.")
    sha = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("SHA de fonte inválido.")
    expected = os.environ.get("CONNECT_DEPLOYER_EXPECTED_SHA", "")
    if expected and sha != expected:
        raise ValueError("Checkout diferente do commit validado.")
    release_tag = os.environ.get("CONNECT_DEPLOYER_RELEASE_TAG", "")
    if release_tag and release_tag != f"v{version}":
        raise ValueError("Tag da release difere da versão canônica da aplicação.")
    canonical = (repo / "install-connect.py").read_bytes()
    reference = (ROOT / "reference/install-connect-original.py").read_bytes()
    if canonical != reference:
        raise ValueError("O instalador canônico mudou. Reconcilie o payload SSH antes de publicar o binário.")
    payload = (ROOT / "src/connect_deployer/payload/install-connect.py").read_bytes()
    channel = os.environ.get("CONNECT_DEPLOYER_CHANNEL", "local")
    if channel not in {"pr", "develop", "stable", "manual", "local"}:
        raise ValueError("Canal de build inválido.")
    target = target_name()
    if os.environ.get("CONNECT_DEPLOYER_TARGET", target) != target:
        raise ValueError("Runner não corresponde ao sistema/arquitetura declarados.")
    info = {
        "schema_version": 1, "project": "ARGWS Connect API",
        "repository": "wkarts/ARGWS-Connect-API", "project_version": version,
        "deployer_version": literal_version(ROOT / "src/connect_deployer/__init__.py", "__version__"),
        "payload_version": literal_version(ROOT / "src/connect_deployer/payload/install-connect.py"),
        "source_sha": sha, "channel": channel, "release_tag": release_tag,
        "target": target, "python": platform.python_version(),
        "payload_sha256": hashlib.sha256(payload).hexdigest(),
        "canonical_installer_sha256": hashlib.sha256(canonical).hexdigest(),
        "publisher_signed": False,
    }
    path = ROOT / "src/connect_deployer/build-info.json"
    path.write_text(json.dumps(info, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(info, indent=2, ensure_ascii=False))
    return info


if __name__ == "__main__":
    prepare()
