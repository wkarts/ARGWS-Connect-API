#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./prepare-env.sh
export COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"
docker compose --env-file .env -f docker-compose.yaml config --quiet
docker compose --env-file .env -f docker-compose.yaml pull
docker compose --env-file .env -f docker-compose.yaml up -d
docker compose --env-file .env -f docker-compose.yaml ps
