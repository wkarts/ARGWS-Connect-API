#!/usr/bin/env python3
"""Validação estrutural offline do ARGWS Connect Deployer.

Não substitui cargo check/npm build; garante que o pacote levado ao GitHub
não está incompleto ou com manifests inválidos.
"""
from __future__ import annotations

import hashlib
import json
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED = [
    "Cargo.toml",
    "rust-toolchain.toml",
    "package.json",
    "index.html",
    "src/App.vue",
    "src/main.ts",
    "src/types/deployer.ts",
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
    "src-tauri/src/main.rs",
    "src-tauri/src/lib.rs",
    "src-tauri/src/ssh.rs",
    "src-tauri/src/commands.rs",
    "crates/deployer-protocol/src/lib.rs",
    "crates/deployer-agent/src/main.rs",
    "crates/deployer-agent/src/deploy.rs",
    "crates/deployer-agent/src/docker.rs",
    "crates/deployer-agent/src/github.rs",
    "crates/deployer-agent/src/envfile.rs",
    "crates/deployer-agent/src/storage.rs",
    "reference/upstream-tauri-build.yml",
    "reference/install-connect-python-original.py",
    "src-tauri/icons/32x32.png",
    "src-tauri/icons/128x128.png",
    "src-tauri/icons/128x128@2x.png",
    "src-tauri/icons/icon.ico",
    "src-tauri/icons/icon.icns",
]


def fail(message: str) -> None:
    print(f"[ERRO] {message}", file=sys.stderr)
    raise SystemExit(2)


for name in REQUIRED:
    path = ROOT / name
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"arquivo obrigatório ausente/vazio: {name}")

for path in ROOT.rglob("*.json"):
    if any(part in {"node_modules", "target", "dist", ".agents"} for part in path.relative_to(ROOT).parts): continue
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"JSON inválido em {path.relative_to(ROOT)}: {exc}")

for path in ROOT.rglob("*.toml"):
    if any(part in {"node_modules", "target", "dist", ".agents"} for part in path.relative_to(ROOT).parts): continue
    try:
        tomllib.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"TOML inválido em {path.relative_to(ROOT)}: {exc}")

workspace = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))
members = set(workspace.get("workspace", {}).get("members", []))
for expected in {"crates/deployer-protocol", "crates/deployer-agent", "src-tauri"}:
    if expected not in members:
        fail(f"workspace Cargo não contém {expected}")

pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
for script in ("build", "tauri:dev", "tauri:build"):
    if script not in pkg.get("scripts", {}):
        fail(f"script npm obrigatório ausente: {script}")

source = (ROOT / "crates/deployer-agent/src/deploy.rs").read_text(encoding="utf-8")
for marker in (
    "Produção não pode usar a versão develop",
    "Deploy exige o Docker local do VPS",
    "Volumes, portas ou identidade de dados mudariam",
    "Instalar Dockge requer ação aplicar",
):
    if marker not in source and marker not in (ROOT / "crates/deployer-agent/src/github.rs").read_text(encoding="utf-8") and marker not in (ROOT / "crates/deployer-agent/src/docker.rs").read_text(encoding="utf-8"):
        fail(f"proteção funcional não localizada: {marker}")


# Tauri: a janela principal precisa coincidir com a capability e o confirm de Apply deve estar autorizado.
tauri = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
windows = tauri.get("app", {}).get("windows", [])
if not windows or windows[0].get("label") != "main":
    fail("janela Tauri principal precisa usar label 'main'")
capability = json.loads((ROOT / "src-tauri/capabilities/default.json").read_text(encoding="utf-8"))
permissions = set(capability.get("permissions", []))
for permission in {"dialog:allow-open", "dialog:allow-confirm"}:
    if permission not in permissions:
        fail(f"capability Tauri ausente: {permission}")

workflow = (ROOT / "reference/upstream-tauri-build.yml").read_text(encoding="utf-8")
for marker in ("linux/amd64", "linux/arm64", "musl-gcc", "npm run tauri:build"):
    if marker not in workflow:
        fail(f"workflow de build incompleto: {marker}")

python_reference = ROOT / "reference/install-connect-python-original.py"
digest = hashlib.sha256(python_reference.read_bytes()).hexdigest()
print(f"[OK] referência Python SHA-256: {digest}")
print("[OK] estrutura, JSON, TOML, workspace, scripts e proteções principais validados.")
