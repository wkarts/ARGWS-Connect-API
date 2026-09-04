from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
STACKS = [
    ROOT / 'deploy/platform',
    ROOT / 'deploy/platform-develop',
    ROOT / 'deploy/platform-production',
]

BROKEN_REDIS = 'test: ["CMD-SHELL", "redis-cli -a \'$${REDIS_PASSWORD}\' ping | grep PONG"]'
FIXED_REDIS = 'test: ["CMD-SHELL", "REDISCLI_AUTH=\\\"$${REDIS_PASSWORD}\\\" redis-cli ping | grep -q \'^PONG$\'"]'
BROKEN_PG = 'test: ["CMD-SHELL", "pg_isready -U \'$${POSTGRES_USER}\' -d \'$${POSTGRES_DB}\'"]'
FIXED_PG = 'test: ["CMD-SHELL", "pg_isready -U \\\"$${POSTGRES_USER}\\\" -d \\\"$${POSTGRES_DB}\\\""]'

STATUS_SCRIPT = r'''#!/usr/bin/env bash
set -euo pipefail
STACK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env}"
[[ -f "$ENV_FILE" ]] || ENV_FILE="$STACK_DIR/env.example"
COMPOSE_FILE="$STACK_DIR/compose.yaml"
compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${compose[@]}" ps

echo
mapfile -t ids < <("${compose[@]}" ps -q)
for id in "${ids[@]}"; do
  [[ -n "$id" ]] || continue
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || true)"
  if [[ "$health" == "unhealthy" ]]; then
    name="$(docker inspect --format '{{.Name}}' "$id" | sed 's#^/##')"
    echo "================================================================"
    echo " HEALTHCHECK FALHANDO: $name"
    echo "================================================================"
    docker inspect --format '{{range .State.Health.Log}}{{printf "%s exit=%d\n%s\n" .End .ExitCode .Output}}{{end}}' "$id" 2>/dev/null | tail -n 40 || true
    echo
  fi
done
'''

PREPARE_SCRIPT = r'''#!/usr/bin/env bash
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
'''

SMTP_BLOCK_BY_STACK = {
    'platform-develop': '''# --------------------------------------------------------------------------
# E-mail interno / recuperacao de senha
# --------------------------------------------------------------------------
SMTP_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_SECURITY=starttls
SMTP_FROM_EMAIL=nao-responda@connect.argws.com.br
SMTP_FROM_NAME=Connect|API Platform
SMTP_TIMEOUT_SECONDS=30
PASSWORD_RESET_URL=https://d.control.connect.argws.com.br/reset-password
PASSWORD_RESET_TOKEN_TTL_MINUTES=30
PASSWORD_RESET_REQUESTS_PER_ACCOUNT_HOUR=5
PASSWORD_RESET_REQUESTS_PER_IP_HOUR=30
PASSWORD_RESET_ATTEMPTS_PER_IP_HOUR=30
''',
    'platform-production': '''# --------------------------------------------------------------------------
# E-mail interno / recuperacao de senha
# --------------------------------------------------------------------------
SMTP_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_SECURITY=starttls
SMTP_FROM_EMAIL=nao-responda@connect.argws.com.br
SMTP_FROM_NAME=Connect|API Platform
SMTP_TIMEOUT_SECONDS=30
PASSWORD_RESET_URL=https://control.connect.argws.com.br/reset-password
PASSWORD_RESET_TOKEN_TTL_MINUTES=30
PASSWORD_RESET_REQUESTS_PER_ACCOUNT_HOUR=5
PASSWORD_RESET_REQUESTS_PER_IP_HOUR=30
PASSWORD_RESET_ATTEMPTS_PER_IP_HOUR=30
''',
}


def patch_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: esperado 1 marcador em {path}, encontrado {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def merge_smtp(stack: Path) -> None:
    env = stack / 'env.example'
    split = stack / 'env.smtp.example'
    text = env.read_text(encoding='utf-8')
    if 'SMTP_ENABLED=' not in text:
        if split.exists():
            block = split.read_text(encoding='utf-8').strip()
        else:
            block = SMTP_BLOCK_BY_STACK[stack.name].strip()
        marker = '# --------------------------------------------------------------------------\n# Integrações opcionais'
        if marker in text:
            text = text.replace(marker, block + '\n\n' + marker, 1)
        else:
            text = text.rstrip() + '\n\n' + block + '\n'
        env.write_text(text, encoding='utf-8')
    split.unlink(missing_ok=True)


def main() -> None:
    for stack in STACKS:
        compose = stack / 'compose.yaml'
        patch_once(compose, BROKEN_REDIS, FIXED_REDIS, 'Redis healthcheck')

    # O compose generico tinha o mesmo erro de quoting no PostgreSQL.
    generic = ROOT / 'deploy/platform/compose.yaml'
    text = generic.read_text(encoding='utf-8')
    text = text.replace(BROKEN_PG, FIXED_PG)
    generic.write_text(text, encoding='utf-8')

    develop_compose = ROOT / 'deploy/platform-develop/compose.yaml'
    text = develop_compose.read_text(encoding='utf-8').replace(
        'APP_ENV: ${PLATFORM_APP_ENV:-develop}',
        'APP_ENV: ${PLATFORM_APP_ENV:-development}',
    )
    develop_compose.write_text(text, encoding='utf-8')

    develop_env = ROOT / 'deploy/platform-develop/env.example'
    develop_env.write_text(
        develop_env.read_text(encoding='utf-8').replace('PLATFORM_APP_ENV=develop', 'PLATFORM_APP_ENV=development'),
        encoding='utf-8',
    )

    # Elimina o SMTP separado nas stacks standalone e deixa cada env.example autocontido.
    for name in ('platform-develop', 'platform-production'):
        stack = ROOT / 'deploy' / name
        merge_smtp(stack)
        (stack / 'prepare-env.sh').write_text(PREPARE_SCRIPT, encoding='utf-8')
        (stack / 'status.sh').write_text(STATUS_SCRIPT, encoding='utf-8')

    # O profile generico ja usa um unico env.example; melhora apenas o diagnostico de status.
    generic_stack = ROOT / 'deploy/platform'
    (generic_stack / 'status.sh').write_text(STATUS_SCRIPT, encoding='utf-8')

    # Guardas simples que falham o workflow se a regressao permanecer.
    for stack in STACKS:
        compose = (stack / 'compose.yaml').read_text(encoding='utf-8')
        if BROKEN_REDIS in compose or FIXED_REDIS not in compose:
            raise RuntimeError(f'healthcheck Redis invalido em {stack}')
    for name in ('platform-develop', 'platform-production'):
        stack = ROOT / 'deploy' / name
        env_text = (stack / 'env.example').read_text(encoding='utf-8')
        if 'SMTP_ENABLED=' not in env_text or 'PASSWORD_RESET_URL=' not in env_text:
            raise RuntimeError(f'env.example incompleto em {stack}')
        if (stack / 'env.smtp.example').exists():
            raise RuntimeError(f'env.smtp.example ainda existe em {stack}')

    print('Redis healthcheck corrigido e env standalone consolidado com sucesso.')


if __name__ == '__main__':
    main()
