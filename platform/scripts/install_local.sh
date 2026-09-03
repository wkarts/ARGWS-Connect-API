#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
source "$ROOT/scripts/deploy/lib.sh"
require_cmd docker; docker compose version >/dev/null || die "Docker Compose v2 ausente"
[[ -f .env ]] || cp .env.example .env
for entry in \
  APP_ENV=development APP_DEBUG=true PUBLIC_SCHEME=http PLATFORM_DOMAIN=localhost \
  CONTROL_PLANE_HOST=control.localhost API_HOST=api.localhost TENANT_DOMAIN_ROOT=localhost \
  TRUSTED_HOSTS=localhost,127.0.0.1,.localhost \
  CORS_ORIGINS=http://localhost:8800,http://control.localhost:8800,http://demo.localhost:8800 \
  GATEWAY_BIND_IP=0.0.0.0 GATEWAY_PORT=8800 PROVISIONING_ASYNC=false \
  BOOTSTRAP_DEMO_TENANT=true ALLOW_DEV_TENANT_HEADER=true; do
  set_env .env "${entry%%=*}" "${entry#*=}"
done
python3 scripts/generate_secrets.py --env .env
ensure_runtime_files "$ROOT" .env
validate_project "$ROOT" true
compose_cmd .env config --quiet
compose_cmd .env up -d --build --remove-orphans
wait_ready 8800 || die "Ambiente local não ficou saudável"
printf 'Control Plane: http://control.localhost:8800\nTenant demo: http://demo.localhost:8800\nCredenciais: %s/.bootstrap-credentials.txt\n' "$ROOT"
