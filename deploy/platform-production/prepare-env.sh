#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[[ -f env.example ]] || { echo "ERRO: env.example nao encontrado." >&2; exit 1; }
[[ -f env.smtp.example ]] || { echo "ERRO: env.smtp.example nao encontrado." >&2; exit 1; }

created=0
if [[ ! -f .env ]]; then
  cp env.example .env
  created=1
  echo ".env base criado."
else
  echo ".env existente preservado."
fi

CREATED="$created" python3 - <<'PY'
from pathlib import Path
import os
import re
import secrets

path = Path('.env')
text = path.read_text(encoding='utf-8')
template = Path('env.smtp.example').read_text(encoding='utf-8')
existing = set(re.findall(r'^([A-Z][A-Z0-9_]*)=', text, flags=re.M))
missing: list[str] = []
for line in template.splitlines():
    match = re.match(r'^([A-Z][A-Z0-9_]*)=', line)
    if match and match.group(1) not in existing:
        missing.append(line)
        existing.add(match.group(1))
if missing:
    text = text.rstrip() + '\n\n# E-mail interno / recuperação de senha\n' + '\n'.join(missing) + '\n'

if os.environ.get('CREATED') == '1':
    version = Path('../../VERSION').read_text(encoding='utf-8').strip()
    text = re.sub(r'^CONNECT_API_VERSION=.*$', f'CONNECT_API_VERSION={version}', text, flags=re.M)
    placeholders = sorted(set(re.findall(r'CHANGE_ME_[A-Z0-9_]+', text)))
    for placeholder in placeholders:
        size = 48 if 'API_KEY' in placeholder else 40 if 'TOKEN' in placeholder else 32
        text = text.replace(placeholder, secrets.token_hex(size))
    print(f'.env criado · versão={version} · {len(placeholders)} segredos fortes gerados.')

path.write_text(text, encoding='utf-8')
print(f'Configuração SMTP complementada · {len(missing)} chave(s) adicionada(s).')
PY

chmod 600 .env
echo "Platform production preparada: argws-connect-platform-production"
