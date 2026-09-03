#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIRS = {
    ".git", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "node_modules",
    "dist", "financial-data", ".releases", "release-artifacts", "__pycache__", "htmlcov", "coverage",
}
EXCLUDED_FILES = {
    ".env", ".bootstrap-credentials.txt", ".coverage", "rclone.conf",
    "backup-age-identity.txt",
}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".log"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def should_include(relative: Path) -> bool:
    if any(part in EXCLUDED_DIRS for part in relative.parts):
        return False
    if relative.name in EXCLUDED_FILES or relative.suffix in EXCLUDED_SUFFIXES:
        return False
    if relative.name.startswith("Connect-API-Platform-v") and relative.suffix in {".zip", ".zst", ".gz", ".txt", ".json", ".bundle"}:
        return False
    return True


def source_files(root: Path) -> list[Path]:
    return sorted(
        path for path in root.rglob("*")
        if path.is_file() and should_include(path.relative_to(root))
    )


def copy_tree(source: Path, target: Path) -> None:
    for path in source_files(source):
        relative = path.relative_to(source)
        if path.is_symlink():
            raise RuntimeError(f"Link simbólico não permitido na distribuição: {relative}")
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)


def inventory(root: Path, version: str) -> dict[str, object]:
    files = [
        path for path in source_files(root)
        if path.name not in {"MANIFEST.sha256", "PACKAGE_INVENTORY.json"}
    ]
    return {
        "application": "Connect|API Platform",
        "version": version,
        "generated_at": datetime.now().astimezone().isoformat(),
        "file_count": len(files),
        "bytes": sum(path.stat().st_size for path in files),
        "groups": {
            "python": len([path for path in files if path.suffix == ".py"]),
            "vue": len([path for path in files if path.suffix == ".vue"]),
            "typescript": len([path for path in files if path.suffix == ".ts"]),
            "shell": len([path for path in files if path.suffix == ".sh"]),
            "yaml": len([path for path in files if path.suffix in {".yml", ".yaml"}]),
            "documentation": len([path for path in files if path.suffix == ".md"]),
        },
        "excluded": {
            "directories": sorted(EXCLUDED_DIRS),
            "files": sorted(EXCLUDED_FILES),
            "suffixes": sorted(EXCLUDED_SUFFIXES),
        },
    }


def write_package_contents(root: Path, version: str) -> None:
    excluded = {"MANIFEST.sha256", "PACKAGE_INVENTORY.json", "PACKAGE_CONTENTS.txt"}
    files = [path for path in source_files(root) if path.name not in excluded]
    lines = [
        "Connect|API Platform — conteúdo da distribuição",
        f"Versão: {version}",
        f"Arquivos de origem: {len(files)}",
        "",
        *[path.relative_to(root).as_posix() for path in files],
    ]
    (root / "PACKAGE_CONTENTS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_manifest(root: Path) -> None:
    manifest = root / "MANIFEST.sha256"
    entries = []
    for path in source_files(root):
        if path == manifest:
            continue
        entries.append(f"{sha256(path)}  {path.relative_to(root).as_posix()}")
    manifest.write_text("\n".join(entries) + "\n", encoding="utf-8")


def verify_manifest(root: Path) -> int:
    manifest = root / "MANIFEST.sha256"
    count = 0
    for line_number, line in enumerate(manifest.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            expected, relative = line.split("  ", 1)
        except ValueError as exc:
            raise RuntimeError(f"Manifest inválido na linha {line_number}") from exc
        path = root / relative
        if not path.is_file():
            raise RuntimeError(f"Arquivo do manifest ausente: {relative}")
        if sha256(path) != expected:
            raise RuntimeError(f"Checksum divergente: {relative}")
        count += 1
    return count


def write_zip(source_dir: Path, destination: Path) -> None:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        top = source_dir.name
        for path in source_files(source_dir):
            relative = Path(top) / path.relative_to(source_dir)
            info = zipfile.ZipInfo.from_file(path, arcname=relative.as_posix())
            info.compress_type = zipfile.ZIP_DEFLATED
            if os.access(path, os.X_OK):
                info.external_attr = (stat.S_IFREG | 0o755) << 16
            with path.open("rb") as stream:
                archive.writestr(info, stream.read(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def verify_archives(zip_path: Path, tar_zst_path: Path, tar_gz_path: Path, package_name: str) -> dict[str, int]:
    results: dict[str, int] = {}
    with tempfile.TemporaryDirectory(prefix="multitenant-app-verify-") as temporary:
        base = Path(temporary)

        zip_target = base / "zip"
        zip_target.mkdir()
        with zipfile.ZipFile(zip_path) as archive:
            bad = archive.testzip()
            if bad:
                raise RuntimeError(f"ZIP corrompido: {bad}")
            archive.extractall(zip_target)
        results["zip_manifest_entries"] = verify_manifest(zip_target / package_name)

        zst_target = base / "tar-zst"
        zst_target.mkdir()
        run(["tar", "--zstd", "-xf", str(tar_zst_path), "-C", str(zst_target)])
        results["tar_zst_manifest_entries"] = verify_manifest(zst_target / package_name)

        gz_target = base / "tar-gz"
        gz_target.mkdir()
        run(["tar", "-xzf", str(tar_gz_path), "-C", str(gz_target)])
        results["tar_gz_manifest_entries"] = verify_manifest(gz_target / package_name)
    if len(set(results.values())) != 1:
        raise RuntimeError(f"Quantidade de entradas divergente entre arquivos: {results}")
    return results


def run(command: Iterable[str], *, cwd: Path | None = None) -> None:
    result = subprocess.run(list(command), cwd=cwd, text=True, check=False)
    if result.returncode:
        raise SystemExit(result.returncode)


def artifact(path: Path) -> dict[str, object]:
    return {"name": path.name, "size": path.stat().st_size, "sha256": sha256(path)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Empacota uma release íntegra da Connect|API Platform.")
    parser.add_argument("--output-dir", type=Path, default=ROOT.parent)
    parser.add_argument("--skip-validation", action="store_true")
    args = parser.parse_args()

    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    package_name = f"Connect-API-Platform-v{version}"
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)

    if not args.skip_validation:
        run([sys.executable, str(ROOT / "scripts/validate_project.py")], cwd=ROOT)

    zip_path = output / f"{package_name}.zip"
    tar_zst_path = output / f"{package_name}.tar.zst"
    tar_gz_path = output / f"{package_name}.tar.gz"
    checksums_path = output / f"{package_name}-SHA256SUMS.txt"
    report_path = output / f"{package_name}-PACKAGE_REPORT.json"
    for path in (zip_path, tar_zst_path, tar_gz_path, checksums_path, report_path):
        path.unlink(missing_ok=True)

    with tempfile.TemporaryDirectory(prefix="multitenant-app-package-") as temporary:
        staging_root = Path(temporary) / package_name
        staging_root.mkdir(parents=True)
        copy_tree(ROOT, staging_root)
        package_inventory = inventory(staging_root, version)
        (staging_root / "PACKAGE_INVENTORY.json").write_text(
            json.dumps(package_inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        write_package_contents(staging_root, version)
        write_manifest(staging_root)
        manifest_entries = verify_manifest(staging_root)

        write_zip(staging_root, zip_path)
        run(["tar", "--zstd", "-cf", str(tar_zst_path), package_name], cwd=Path(temporary))
        run(["tar", "-czf", str(tar_gz_path), package_name], cwd=Path(temporary))

    archive_verification = verify_archives(zip_path, tar_zst_path, tar_gz_path, package_name)
    artifacts = [artifact(zip_path), artifact(tar_zst_path), artifact(tar_gz_path)]
    checksums_path.write_text(
        "".join(f"{item['sha256']}  {item['name']}\n" for item in artifacts), encoding="utf-8"
    )
    report = {
        "status": "PASS",
        "application": "Connect|API Platform",
        "version": version,
        "generated_at": datetime.now().astimezone().isoformat(),
        "manifest_entries": manifest_entries,
        "archive_verification": archive_verification,
        "inventory": package_inventory,
        "artifacts": artifacts,
        "checksums_file": checksums_path.name,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "version": version,
        "zip": str(zip_path),
        "tar_zst": str(tar_zst_path),
        "tar_gz": str(tar_gz_path),
        "checksums": str(checksums_path),
        "report": str(report_path),
        "manifest_entries": manifest_entries,
        "archive_verification": archive_verification,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
