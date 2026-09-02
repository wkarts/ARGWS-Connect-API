#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || cp env.example .env
./preflight.sh
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --remove-orphans
docker compose --env-file .env -f compose.yaml ps
echo "DOCs local: http://127.0.0.1:${ARGWS_CONNECT_DOCS_HOST_PORT:-38280}"
echo "DOCs public: ${DOCS_PUBLIC_URL:-https://api.connect.argws.com.br/docs/}"
