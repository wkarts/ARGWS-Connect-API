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
grep -q '^COMPOSE_PROJECT_NAME=argws-connect-platform-production$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_NETWORK_NAME=argws-connect-platform-production-net$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:latest$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_DOCS_IMAGE=ghcr.io/wkarts/argws-connect-docs:latest$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_API_IMAGE=ghcr.io/wkarts/argws-connect-platform-api:latest$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_WEB_IMAGE=ghcr.io/wkarts/argws-connect-platform-web:latest$' "$ENV_FILE"
grep -q '^ARGWS_CONNECT_PLATFORM_GATEWAY_IMAGE=ghcr.io/wkarts/argws-connect-platform-gateway:latest$' "$ENV_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null
python3 "$ROOT_DIR/platform/scripts/validate_project.py" >/dev/null
echo "Preflight PASS · project=argws-connect-platform-production · version=$VERSION"
