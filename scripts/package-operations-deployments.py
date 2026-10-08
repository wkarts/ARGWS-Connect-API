#!/usr/bin/env python3
"""Package deployment templates and verify every ZIP member before emitting evidence."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

REQUIRED = (
    "docs/operations/deploy-and-statistics.md",
    "docker-compose.yaml",
    "docker-compose.dev.yaml",
    "env.example",
    ".env.example",
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def excluded(path):
    return (path.name == ".env" or path.name.endswith(".lock")
            or "__pycache__" in path.parts or "volumes" in path.parts)


def source_files(root):
    deploy = root / "deploy"
    if not deploy.is_dir() or deploy.is_symlink():
        raise ValueError("Missing or unsafe deploy directory")
    selected = {}
    for relative in REQUIRED:
        path = root / relative
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Missing or unsafe required template: {relative}")
        selected[relative] = path.read_bytes()
    for path in sorted(deploy.rglob("*")):
        relative = path.relative_to(root)
        if excluded(relative):
            continue
        if path.is_symlink():
            raise ValueError(f"Symlink cannot be packaged: {relative.as_posix()}")
        if path.is_file():
            selected[relative.as_posix()] = path.read_bytes()
    if not any(name.startswith("deploy/") for name in selected):
        raise ValueError("No deployment templates found")
    return dict(sorted(selected.items()))


def verify_archive(archive_path, expected):
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(expected):
            raise ValueError("ZIP member inventory does not match deployment sources")
        if archive.testzip() is not None:
            raise ValueError("ZIP CRC validation failed")
        for name, data in expected.items():
            if archive.read(name) != data:
                raise ValueError(f"ZIP content does not match source: {name}")


def package(root, output, revision):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Invalid source revision")
    root, output = Path(root).resolve(), Path(output).resolve()
    expected = source_files(root)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".zip", delete=False) as handle:
            temporary = Path(handle.name)
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in expected.items():
                # Stable metadata makes equal source bytes produce equal packages.
                entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, data)
        verify_archive(temporary, expected)
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    archive_bytes = output.read_bytes()
    return {
        "schema": 1,
        "kind": "operations-deployment-package",
        "sourceRevision": revision,
        "archive": {"file": output.name, "bytes": len(archive_bytes), "sha256": digest(archive_bytes)},
        "fileCount": len(expected),
        "inventory": [{"file": name, "bytes": len(data), "sha256": digest(data)}
                      for name, data in expected.items()],
    }


def emit_evidence(receipt, summary_path=None):
    print(json.dumps(receipt, sort_keys=True))
    if summary_path:
        archive = receipt["archive"]
        lines = ["### Operations deployment package verified", "",
                 f"Source revision: `{receipt['sourceRevision']}`", "",
                 f"ZIP: `{archive['file']}` ({archive['bytes']} bytes), SHA256 `{archive['sha256']}`.",
                 f"Verified {receipt['fileCount']} source files, ZIP CRC and exact member contents.", "",
                 "| File | Bytes | SHA256 |", "| --- | ---: | --- |"]
        for item in receipt["inventory"]:
            name = item["file"].replace("|", "&#124;").replace("`", "&#96;")
            lines.append(f"| `{name}` | {item['bytes']} | `{item['sha256']}` |")
        with open(summary_path, "a", encoding="utf-8") as summary:
            summary.write("\n".join(lines) + "\n")


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(root / "Connect-API-Deployments-Operations.zip"))
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    if args.revision != head:
        raise ValueError("Source revision does not match checkout HEAD")
    receipt = package(root, args.output, args.revision)
    emit_evidence(receipt, os.environ.get("GITHUB_STEP_SUMMARY"))


if __name__ == "__main__":
    main()
