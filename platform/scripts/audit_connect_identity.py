#!/usr/bin/env python3
"""Audita resíduos do domínio Financial sem apagar a identidade técnica ARGWS Connect existente."""
from __future__ import annotations

from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[2]
SKIP_PARTS = {
    ".git", "node_modules", ".venv", "__pycache__", "dist", "build",
    "reference-origin", "core-source", "docs-source", "extensions-source",
}
SKIP_FILES = {"LICENSE", "audit_connect_identity.py", "audit_legacy_identity.py"}
FORBIDDEN = {
    "ARGWS Financial Platform": "marca financeira anterior",
    "ARGWS Financial": "marca financeira anterior",
    "finance.argws.com.br": "domínio financeiro anterior",
    "financial-internal": "rede financeira anterior",
    "financial-observability": "rede financeira anterior",
    "FINANCIAL_DATA_ROOT": "variável financeira anterior",
    "fin_tenant": "prefixo financeiro anterior",
}

found: list[tuple[str, str, int]] = []
for path in REPO.rglob("*"):
    if not path.is_file() or path.name in SKIP_FILES:
        continue
    if any(part in SKIP_PARTS for part in path.parts):
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    for term in FORBIDDEN:
        count = text.count(term)
        if count:
            found.append((str(path.relative_to(REPO)), term, count))

if found:
    print("IDENTITY_AUDIT=FAIL")
    for file_name, term, count in found:
        print(f"- {file_name}: {term!r} x{count}")
    sys.exit(1)

print("IDENTITY_AUDIT=PASS")
print("- identidade técnica ARGWS Connect preservada")
print("- resíduos Financial ativos não encontrados")
