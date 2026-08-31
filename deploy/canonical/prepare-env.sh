#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

STACK_NAME="canonical"
IMAGE_POLICY="ghcr.io/wkarts/argws-connect-api:1.0.7"

if [[ ! -f env.example ]]; then
  echo "ERRO: env.example nao encontrado."
  exit 1
fi

if [[ ! -f .env ]]; then
  cp env.example .env
  chmod 600 .env
  python3 - <<'PYENV'
from pathlib import Path
import re
import secrets
path = Path('.env')
text = path.read_text()
placeholders = sorted(set(re.findall(r'CHANGE_ME_[A-Z0-9_]+', text)))
for placeholder in placeholders:
    value = secrets.token_hex(48 if 'API_KEY' in placeholder else 40 if 'TOKEN' in placeholder else 32)
    text = text.replace(placeholder, value)
path.write_text(text)
print(f'.env criado com {len(placeholders)} segredos fortes.')
PYENV
else
  echo ".env existente preservado; somente enderecos legados serao normalizados."
fi

python3 - <<'PYENV'
from pathlib import Path
import re
stack = 'canonical'
path = Path('.env')
text = path.read_text()
resources = ('postgres','redis','rabbitmq','minio','nats','kafka','zookeeper')
for resource in resources:
    text = text.replace(f'argws-connect-{resource}', f'{resource}-argws-connect-{stack}')
    text = re.sub(rf'{resource}-argws-connect-(production|develop|canonical)(?![-a-z0-9])', f'{resource}-argws-connect-{stack}', text)
text = re.sub(r'^COMPOSE_PROJECT_NAME=.*$', f'COMPOSE_PROJECT_NAME=argws-connect-{stack}', text, flags=re.M)
text = re.sub(r'^ARGWS_CONNECT_NETWORK_NAME=.*$', f'ARGWS_CONNECT_NETWORK_NAME=argws-connect-{stack}-net', text, flags=re.M)
text = re.sub(r'^ARGWS_CONNECT_API_IMAGE=.*$', 'ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:1.0.7', text, flags=re.M)
path.write_text(text)
PYENV
chmod 600 .env
echo "Stack ${STACK_NAME} preparada."
