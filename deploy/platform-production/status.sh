#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="$ROOT_DIR/deploy/platform-production"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env}"
COMPOSE_FILE="$STACK_DIR/compose.yaml"
[[ -f "$ENV_FILE" ]] || { echo "Ambiente ausente: $ENV_FILE" >&2; exit 1; }
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
