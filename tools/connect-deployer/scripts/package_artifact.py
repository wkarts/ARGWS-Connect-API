"""Publishable archives preserve executable mode and include build provenance."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def archive_name(info: dict) -> str:
    for key in ("project_version", "channel", "source_sha", "target"):
        if not re.fullmatch(r"[a-zA-Z0-9._-]+", info[key]):
            raise ValueError("Identidade de pacote inválida.")
    return f"connect-deploy-{info['project_version']}-{info['channel']}-{info['source_sha'][:12]}-{info['target']}.zip"


def third_party_files() -> dict[str, bytes]:
    output = {}
    dependencies = []
    for distribution in sorted(importlib.metadata.distributions(), key=lambda d: d.metadata["Name"].lower()):
        name = distribution.metadata["Name"]
        if name.lower() == "argws-connect-deployer":
            continue
        dependencies.append(f"{name}=={distribution.version}")
        safe = re.sub(r"[^a-zA-Z0-9._-]", "_", name)
        # Preserve wheel metadata verbatim. Serializing the parsed email.Message
        # rejects valid multiline legacy Description headers (for example altgraph).
        metadata = distribution.read_text("METADATA") or distribution.read_text("PKG-INFO")
        if metadata is None:
            metadata = json.dumps(list(distribution.metadata.items()), ensure_ascii=False, indent=2) + "\n"
        output[f"THIRD-PARTY/{safe}/METADATA.txt"] = metadata.encode("utf-8")
        for file in distribution.files or []:
            parts = [part.lower() for part in file.parts]
            if (any(part.endswith((".dist-info", ".egg-info")) for part in parts)
                    and ("licenses" in parts or file.name.lower().startswith(("license", "copying", "notice")))):
                path = Path(distribution.locate_file(file))
                if path.is_file():
                    output[f"THIRD-PARTY/{safe}/" + "/".join(file.parts)] = path.read_bytes()
    output["DEPENDENCIES.txt"] = ("\n".join(dependencies) + "\n").encode()
    return output


def main() -> None:
    info = json.loads((ROOT / "src/connect_deployer/build-info.json").read_text())
    binary = "connect-deploy.exe" if info["target"].startswith("windows-") else "connect-deploy"
    source = ROOT / "dist" / binary
    if not source.is_file():
        raise ValueError("Binário não encontrado; compile e valide antes de empacotar.")
    files = {binary: source.read_bytes(),
             "BUILD-INFO.json": (json.dumps(info, indent=2, ensure_ascii=False) + "\n").encode(),
             "README.md": (ROOT / "README.md").read_bytes(),
             "SECURITY.md": (ROOT / "SECURITY.md").read_bytes()}
    for name in ("LICENSE", "NOTICE", "TRADEMARKS.md"):
        path = ROOT.parents[1] / name
        if path.is_file(): files[name] = path.read_bytes()
    files.update(third_party_files())
    files["SHA256SUMS.txt"] = ("\n".join(f"{hashlib.sha256(data).hexdigest()}  {name}"
                                       for name, data in sorted(files.items())) + "\n").encode()
    release = ROOT / "dist/release"
    release.mkdir(parents=True, exist_ok=True)
    target = release / archive_name(info)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (0o100755 if name == binary else 0o100644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix(".zip.sha256").write_text(f"{digest}  {target.name}\n", encoding="ascii")
    print(target)
    print(digest)


if __name__ == "__main__":
    main()
