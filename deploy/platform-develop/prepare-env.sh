#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f env.example ]]; then
  echo "ERRO: env.example nao encontrado." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp env.example .env
  chmod 600 .env
  python3 - <<'PY'
from pathlib import Path
import re
import secrets

path = Path('.env')
text = path.read_text(encoding='utf-8')
version = Path('../../VERSION').read_text(encoding='utf-8').strip()
text = re.sub(r'^CONNECT_API_VERSION=.*$', f'CONNECT_API_VERSION={version}', text, flags=re.M)

placeholders = sorted(set(re.findall(r'CHANGE_ME_[A-Z0-9_]+', text)))
for placeholder in placeholders:
    size = 48 if 'API_KEY' in placeholder else 40 if 'TOKEN' in placeholder else 32
    text = text.replace(placeholder, secrets.token_hex(size))

path.write_text(text, encoding='utf-8')
print(f'.env criado · versão={version} · {len(placeholders)} segredos fortes gerados.')
PY
else
  echo ".env existente preservado."
fi

chmod 600 .env
echo "Platform develop preparada: argws-connect-platform-develop"
