#!/usr/bin/env python3
"""Audita resíduos de identidade e namespace técnico anteriores no runtime ativo."""
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {
    '.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build',
    'reference-origin', 'core-source', 'docs-source', 'extensions-source',
}
SKIP_FILES = {'LICENSE', 'audit_connect_identity.py', 'audit_legacy_identity.py', 'MANIFEST.sha256', 'PACKAGE_CONTENTS.txt', 'PACKAGE_INVENTORY.json'}
FORBIDDEN = {
    'ARGWS Financial Platform': 'marca anterior',
    'ARGWS Financial': 'marca anterior',
    'connect-apiancial': 'slug anterior',
    'argws_financial': 'namespace anterior',
    'finance.argws.com.br': 'domínio anterior',
    'financial-api': 'serviço anterior',
    'financial-web': 'serviço anterior',
    'financial-gateway': 'serviço anterior',
    'fin_tenant': 'prefixo de tenant anterior',
    'FINANCIAL_DATA_ROOT': 'variável operacional anterior',
    'financial-internal': 'rede Docker anterior',
    'financial-observability': 'rede Docker anterior',
    'connect_api_tsage': 'identificador inválido',
    'YOUR_APP-': 'placeholder de nome de imagem não especializado',
    'argws-connect': 'namespace técnico anterior',
    '_argws': 'identificador interno anterior',
}

found: list[tuple[str, str, str, int]] = []
for path in ROOT.rglob('*'):
    if not path.is_file() or path.name in SKIP_FILES:
        continue
    if any(part in SKIP_PARTS for part in path.parts):
        continue
    try:
        text = path.read_text(encoding='utf-8')
    except (UnicodeDecodeError, OSError):
        continue
    for term, meaning in FORBIDDEN.items():
        count = text.count(term)
        if count:
            found.append((str(path.relative_to(ROOT)), term, meaning, count))

if found:
    print('FALHA: resíduos de identidade/namespace encontrados no runtime ativo:')
    for file_name, term, meaning, count in found:
        print(f' - {file_name}: {term!r} ({meaning}) x{count}')
    sys.exit(1)

print('OK: identidade e namespaces técnicos ativos estão padronizados para Connect|API Platform.')
