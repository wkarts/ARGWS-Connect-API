#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="$ROOT_DIR/deploy/platform-production"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env}"
COMPOSE_FILE="$STACK_DIR/compose.yaml"

command -v docker >/dev/null || { echo "Docker nao encontrado." >&2; exit 1; }
docker compose version >/dev/null
[[ -f "$ENV_FILE" ]] || { echo "Ambiente ausente: $ENV_FILE. Execute prepare-env.sh." >&2; exit 1; }
if grep -Eq '=CHANGE_ME|CHANGE_ME_' "$ENV_FILE"; then
  echo "Ha segredos CHANGE_ME em $ENV_FILE." >&2
  exit 1
fi

VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
ENV_VERSION="$(grep '^CONNECT_API_VERSION=' "$ENV_FILE" | cut -d= -f2- || true)"
[[ "$VERSION" == "$ENV_VERSION" ]] || { echo "CONNECT_API_VERSION=$ENV_VERSION diverge do VERSION=$VERSION." >&2; exit 1; }

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null
rendered_json="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --format json)"
python3 - "$rendered_json" <<'PY2'
import json
import sys
cfg = json.loads(sys.argv[1])
project = 'argws-connect-platform-production'
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
    'platform-scheduler', 'platform-worker-backups',
    'platform-docker-proxy', 'platform-log-agent',
    'platform-prometheus', 'platform-grafana',
    'platform-acme', 'platform-cloudpanel-agent',
    'platform-web', 'platform-gateway',
}
actual = {name[:-len(suffix)] for name in cfg.get('services', {})}
assert actual == expected, (sorted(expected - actual), sorted(actual - expected))
print('Compose contract OK')
PY2

for required in \
  'COMPOSE_PROJECT_NAME=argws-connect-platform-production' \
  'ARGWS_CONNECT_NETWORK_NAME=argws-connect-platform-production-net' \
  'SERVER_URL=https://api.connect.argws.com.br' \
  'ARGWS_CONNECT_DOCS_PUBLIC_URL=https://docs.connect.argws.com.br' \
  'PLATFORM_DOMAIN=connect.argws.com.br' \
  'CONTROL_PLANE_HOST=control.connect.argws.com.br' \
  'ADMIN_HOST=admin.connect.argws.com.br' \
  'PARTNER_PLANE_HOST=partner.connect.argws.com.br' \
  'API_HOST=api.connect.argws.com.br' \
  'DOCS_HOST=docs.connect.argws.com.br' \
  'DEMO_HOST=demo.connect.argws.com.br'; do
  grep -Fqx "$required" "$ENV_FILE" || { echo "Contrato ausente em .env: $required" >&2; exit 1; }
done

grep -q '^ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:latest$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_DOCS_IMAGE=ghcr.io/wkarts/argws-connect-docs:latest$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_API_IMAGE=ghcr.io/wkarts/argws-connect-platform-api:latest$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_WEB_IMAGE=ghcr.io/wkarts/argws-connect-platform-web:latest$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_GATEWAY_IMAGE=ghcr.io/wkarts/argws-connect-platform-gateway:latest$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_DOCKER_PROXY_IMAGE=ghcr.io/wkarts/argws-connect-docker-proxy:v0.5.0$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PROMETHEUS_IMAGE=ghcr.io/wkarts/argws-connect-prometheus:v3.5.0$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_GRAFANA_IMAGE=ghcr.io/wkarts/argws-connect-grafana:12.1.0$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_ACME_IMAGE=ghcr.io/wkarts/argws-connect-platform-acme:latest$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_CLOUDPANEL_AGENT_IMAGE=ghcr.io/wkarts/argws-connect-platform-cloudpanel-agent:latest$' "$ENV_FILE"

if grep -Eqi '^CLOUDFLARE_ENABLED=(true|1|yes)$' "$ENV_FILE"; then
  for key in CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_NAME CLOUDFLARE_TENANT_RECORD_TARGET; do
    value="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
    [[ -n "$value" ]] || { echo "Cloudflare habilitado, mas ${key} está vazio." >&2; exit 1; }
  done
fi

python3 "$ROOT_DIR/platform/scripts/validate_project.py" >/dev/null

echo "Preflight PASS · argws-connect-platform-production · version=$VERSION"
