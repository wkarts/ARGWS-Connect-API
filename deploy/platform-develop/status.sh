#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="$ROOT_DIR/deploy/platform-develop"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env}"
[[ -f "$ENV_FILE" ]] || ENV_FILE="$STACK_DIR/env.example"
docker compose --env-file "$ENV_FILE" -f "$STACK_DIR/compose.yaml" ps
