"""Validate artifacts from this workflow run before associating them with a release."""
from __future__ import annotations

import hashlib
import json
import os
import sys
import zipfile
from pathlib import Path, PurePosixPath

TARGETS = {"windows-x86_64", "linux-x86_64", "linux-arm64", "macos-arm64"}


def verify(directory: Path, sha: str, version: str, channel: str) -> list[str]:
    seen = set()
    checksums = []
    archives = sorted(directory.glob("connect-deploy-*.zip"))
    if len(archives) != len(TARGETS):
        raise ValueError("Os quatro pacotes nativos são obrigatórios.")
    for path in archives:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if path.with_suffix(".zip.sha256").read_text().strip() != f"{digest}  {path.name}":
            raise ValueError("Checksum externo inválido.")
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            names = {entry.filename for entry in entries}
            if len(names) != len(entries) or len(entries) > 1000 or sum(e.file_size for e in entries) > 512 * 1024 * 1024:
                raise ValueError("Estrutura de pacote inválida.")
            for name in names:
                if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or "\\" in name:
                    raise ValueError("Caminho de pacote inválido.")
            metadata = json.loads(archive.read("BUILD-INFO.json"))
            target = metadata["target"]
            if (target not in TARGETS or target in seen or metadata["source_sha"] != sha
                    or metadata["project_version"] != version or metadata["channel"] != channel
                    or metadata["repository"] != "wkarts/ARGWS-Connect-API"):
                raise ValueError("Identidade do binário não corresponde à fonte validada.")
            exe = "connect-deploy.exe" if target.startswith("windows-") else "connect-deploy"
            if not archive.read(exe):
                raise ValueError("Executável vazio.")
            if not target.startswith("windows-") and not ((archive.getinfo(exe).external_attr >> 16) & 0o111):
                raise ValueError("Permissão de execução não preservada.")
            listed = set()
            for line in archive.read("SHA256SUMS.txt").decode("ascii").splitlines():
                expected, name = line.split("  ", 1)
                if name in listed or hashlib.sha256(archive.read(name)).hexdigest() != expected:
                    raise ValueError("Checksum interno inválido.")
                listed.add(name)
            if listed != names - {"SHA256SUMS.txt"}:
                raise ValueError("Inventário de integridade incompleto.")
            seen.add(target)
        checksums.append(f"{digest}  {path.name}")
    if seen != TARGETS:
        raise ValueError("Matriz de plataformas incompleta.")
    return checksums


if __name__ == "__main__":
    root = Path(sys.argv[1])
    lines = verify(root, os.environ["EXPECTED_SHA"], os.environ["EXPECTED_VERSION"], os.environ["EXPECTED_CHANNEL"])
    (root / "CONNECT-DEPLOYER-SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="ascii")
    print("PASS: four packages, internal/external hashes, modes and common project revision")
