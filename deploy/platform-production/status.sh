#!/usr/bin/env bash
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
