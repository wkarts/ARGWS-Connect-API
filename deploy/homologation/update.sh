#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./preflight.sh
docker compose -f compose.yaml pull
docker compose -f compose.yaml up -d --remove-orphans
docker compose -f compose.yaml ps
