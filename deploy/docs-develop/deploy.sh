#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || cp env.example .env
./preflight.sh
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --remove-orphans
docker compose --env-file .env -f compose.yaml ps
public_url="$(grep '^ARGWS_CONNECT_DOCS_PUBLIC_URL=' .env | cut -d= -f2-)"
port="$(grep '^ARGWS_CONNECT_DOCS_HOST_PORT=' .env | cut -d= -f2-)"
echo "DOCs local: http://127.0.0.1:${port}"
echo "DOCs public: ${public_url}"
