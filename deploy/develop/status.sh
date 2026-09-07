#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose --env-file .env -f compose.yaml ps

echo
echo "Manager / Manager API (últimas 100 linhas):"
docker compose --env-file .env -f compose.yaml logs --tail=100 manager-api-argws-connect-develop manager-argws-connect-develop || true
