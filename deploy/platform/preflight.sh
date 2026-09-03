#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE="${1:-${CONNECT_DEPLOYMENT_PROFILE:-platform}}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/platform/.env}"
COMPOSE_FILE="$ROOT_DIR/deploy/platform/compose.yaml"
source "$ROOT_DIR/deploy/platform/profile.sh" "$PROFILE"
command -v docker >/dev/null || { echo "Docker não encontrado." >&2; exit 1; }
docker compose version >/dev/null
[[ -f "$ENV_FILE" ]] || { echo "Ambiente ausente: $ENV_FILE. Execute prepare-env.sh." >&2; exit 1; }
if grep -Eq '=CHANGE_ME|CHANGE_ME_' "$ENV_FILE"; then
  echo "Há segredos CHANGE_ME em $ENV_FILE." >&2
  exit 1
fi
VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
ENV_VERSION="$(grep '^CONNECT_API_VERSION=' "$ENV_FILE" | cut -d= -f2- || true)"
[[ "$VERSION" == "$ENV_VERSION" ]] || { echo "CONNECT_API_VERSION=$ENV_VERSION diverge do VERSION=$VERSION." >&2; exit 1; }
read -r -a EXTRA <<<"${COMPOSE_ARGS_SERIALIZED:-}"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "${EXTRA[@]}" config >/dev/null
python3 "$ROOT_DIR/platform/scripts/validate_project.py" >/dev/null
echo "Preflight PASS · profile=$PROFILE · version=$VERSION"
