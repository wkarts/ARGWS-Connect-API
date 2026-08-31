#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
version="$(grep -E '^ARGWS_CONNECT_CANONICAL_VERSION=' env.example | tail -n1 | cut -d= -f2-)"
if [[ -z "$version" ]]; then
  version="$(tr -d '[:space:]' < ../../VERSION)"
fi
export ARGWS_CONNECT_API_IMAGE="ghcr.io/wkarts/argws-connect-api:${version}"
docker compose --env-file ../production/.env \
  -f ../production/compose.yaml -f compose.yaml ps
