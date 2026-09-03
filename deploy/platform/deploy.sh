#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE="${1:-${CONNECT_DEPLOYMENT_PROFILE:-platform}}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/platform/.env}"
COMPOSE_FILE="$ROOT_DIR/deploy/platform/compose.yaml"
"$ROOT_DIR/deploy/platform/preflight.sh" "$PROFILE"
source "$ROOT_DIR/deploy/platform/profile.sh" "$PROFILE"
read -r -a EXTRA <<<"${COMPOSE_ARGS_SERIALIZED:-}"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "${EXTRA[@]}" pull
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "${EXTRA[@]}" up -d --remove-orphans
echo "Deploy concluído · profile=$PROFILE"
