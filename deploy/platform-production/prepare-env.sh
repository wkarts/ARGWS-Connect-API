#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[[ -f env.example ]] || { echo "ERRO: env.example nao encontrado." >&2; exit 1; }

created=0
if [[ ! -f .env ]]; then
  cp env.example .env
  created=1
  echo ".env criado a partir do env.example completo."
else
  echo ".env existente encontrado; valores atuais serao preservados."
fi

CREATED="$created" python3 - <<'PYENV'
from __future__ import annotations
import os, re, secrets
from pathlib import Path

path = Path('.env')
template_path = Path('env.example')
text = path.read_text(encoding='utf-8')
template = template_path.read_text(encoding='utf-8')
assignment = re.compile(r'^([A-Z][A-Z0-9_]*)=(.*)$')
existing: dict[str, str] = {}
extras: list[str] = []
for raw in text.splitlines():
    m = assignment.match(raw)
    if m:
        existing[m.group(1)] = m.group(2)
    elif raw.strip() and not raw.lstrip().startswith('#'):
        extras.append(raw)

rendered: list[str] = []
template_keys: set[str] = set()
for raw in template.splitlines():
    m = assignment.match(raw)
    if not m:
        rendered.append(raw)
        continue
    key, default = m.group(1), m.group(2)
    template_keys.add(key)
    rendered.append(f"{key}={existing.get(key, default)}")

extra_keys = sorted(set(existing) - template_keys)
if extra_keys or extras:
    rendered += ['', '# --------------------------------------------------------------------------', '# Variaveis locais preservadas', '# --------------------------------------------------------------------------']
    rendered += [f"{key}={existing[key]}" for key in extra_keys]
    rendered += extras

result = '\n'.join(rendered).rstrip() + '\n'
version_file = Path('../../VERSION')
if version_file.exists():
    version = version_file.read_text(encoding='utf-8').strip()
    result = re.sub(r'^CONNECT_API_VERSION=.*$', f'CONNECT_API_VERSION={version}', result, flags=re.M)

if os.environ.get('CREATED') == '1':
    placeholders = sorted(set(re.findall(r'CHANGE_ME_[A-Z0-9_]+', result)))
    for placeholder in placeholders:
        size = 48 if 'API_KEY' in placeholder else 40 if 'TOKEN' in placeholder else 32
        result = result.replace(placeholder, secrets.token_hex(size))
    print(f"Segredos iniciais gerados: {len(placeholders)}")

path.write_text(result, encoding='utf-8')
print('env.example sincronizado com .env sem sobrescrever valores existentes.')
PYENV

chmod 600 .env
project="$(grep '^COMPOSE_PROJECT_NAME=' .env | cut -d= -f2- || true)"
echo "Ambiente preparado${project:+ · project=$project}"
