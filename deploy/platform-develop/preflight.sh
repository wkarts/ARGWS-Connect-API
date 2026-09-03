#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="$ROOT_DIR/deploy/platform-develop"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env}"
COMPOSE_FILE="$STACK_DIR/compose.yaml"

command -v docker >/dev/null || { echo "Docker nao encontrado." >&2; exit 1; }
docker compose version >/dev/null
[[ -f "$ENV_FILE" ]] || { echo "Ambiente ausente: $ENV_FILE. Execute prepare-env.sh." >&2; exit 1; }

if grep -Eq '=CHANGE_ME|CHANGE_ME_' "$ENV_FILE"; then
  echo "Ha placeholders CHANGE_ME em $ENV_FILE." >&2
  exit 1
fi

VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
ENV_VERSION="$(grep '^CONNECT_API_VERSION=' "$ENV_FILE" | cut -d= -f2- || true)"
[[ "$VERSION" == "$ENV_VERSION" ]] || { echo "CONNECT_API_VERSION=$ENV_VERSION diverge do VERSION=$VERSION." >&2; exit 1; }

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null
rendered_json="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --format json)"
python3 - "$rendered_json" <<'PY'
import json
import sys
cfg = json.loads(sys.argv[1])
project = 'argws-connect-platform-develop'
assert cfg.get('name') == project, cfg.get('name')
suffix = '-' + project
for service, data in cfg.get('services', {}).items():
    assert service.endswith(suffix), service
    assert data.get('container_name') == service, service
networks = {item.get('name') for item in cfg.get('networks', {}).values()}
assert project + '-net' in networks, networks
expected = {
    'api', 'docs', 'postgres', 'redis', 'rabbitmq', 'minio',
    'platform-postgres', 'platform-migrate', 'platform-migrate-tenants',
    'platform-bootstrap', 'platform-api', 'platform-worker',
    'platform-scheduler', 'platform-web', 'platform-gateway',
}
actual = {name[:-len(suffix)] for name in cfg.get('services', {})}
assert actual == expected, (sorted(expected - actual), sorted(actual - expected))
print('Compose contract OK')
PY

for required in \
  'COMPOSE_PROJECT_NAME=argws-connect-platform-develop' \
  'ARGWS_CONNECT_NETWORK_NAME=argws-connect-platform-develop-net' \
  'SERVER_URL=https://d.api.connect.argws.com.br' \
  'ARGWS_CONNECT_DOCS_PUBLIC_URL=https://d.docs.connect.argws.com.br' \
  'PLATFORM_DOMAIN=d.connect.argws.com.br' \
  'CONTROL_PLANE_HOST=d.control.connect.argws.com.br' \
  'ADMIN_HOST=d.admin.connect.argws.com.br' \
  'PARTNER_PLANE_HOST=d.partner.connect.argws.com.br' \
  'API_HOST=d.api.connect.argws.com.br' \
  'DOCS_HOST=d.docs.connect.argws.com.br' \
  'DEMO_HOST=d.demo.connect.argws.com.br'; do
  grep -Fqx "$required" "$ENV_FILE" || { echo "Contrato ausente em .env: $required" >&2; exit 1; }
done

grep -q '^ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:develop$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_DOCS_IMAGE=ghcr.io/wkarts/argws-connect-docs:develop$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_API_IMAGE=ghcr.io/wkarts/argws-connect-platform-api:develop$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_WEB_IMAGE=ghcr.io/wkarts/argws-connect-platform-web:develop$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_GATEWAY_IMAGE=ghcr.io/wkarts/argws-connect-platform-gateway:develop$' "$ENV_FILE"

python3 "$ROOT_DIR/platform/scripts/validate_project.py" >/dev/null

echo "Preflight PASS · argws-connect-platform-develop · version=$VERSION"
