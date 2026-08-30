#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose -f compose.yaml ps
echo
curl -fsS "http://127.0.0.1:$(grep -E '^ARGWS_CONNECT_API_HOST_PORT=' .env | tail -n1 | cut -d= -f2-)/health" || true
echo
