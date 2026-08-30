#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  echo ".env de producao ja existe; nenhum segredo foi alterado."
  exit 0
fi

if [[ ! -f env.example ]]; then
  echo "ERRO: env.example nao encontrado."
  exit 1
fi

command -v openssl >/dev/null 2>&1 || {
  echo "ERRO: openssl e obrigatorio para gerar os segredos."
  exit 1
}

cp env.example .env
chmod 600 .env

python3 - <<'PY'
from pathlib import Path
import re
import secrets

path = Path('.env')
text = path.read_text()
placeholders = sorted(set(re.findall(r'CHANGE_ME_[A-Z0-9_]+', text)))

for placeholder in placeholders:
    if 'API_KEY' in placeholder:
        value = secrets.token_hex(48)
    elif 'TOKEN' in placeholder:
        value = secrets.token_hex(40)
    else:
        value = secrets.token_hex(32)
    text = text.replace(placeholder, value)

path.write_text(text)
print(f'.env criado com {len(placeholders)} segredos gerados automaticamente.')
PY

echo "Producao preparada: https://api.connect.argws.com.br"
echo "Arquivo .env criado localmente e protegido com chmod 600."
