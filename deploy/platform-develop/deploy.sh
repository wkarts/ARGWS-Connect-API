#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="$ROOT_DIR/deploy/platform-develop"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env}"
COMPOSE_FILE="$STACK_DIR/compose.yaml"

[[ -f "$ENV_FILE" ]] || bash "$STACK_DIR/prepare-env.sh"
bash "$STACK_DIR/preflight.sh"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans

echo "Deploy concluido · project=argws-connect-platform-develop"
echo "API:      https://d.api.connect.argws.com.br"
echo "DOCs:     https://d.docs.connect.argws.com.br"
echo "Platform: https://d.connect.argws.com.br"
