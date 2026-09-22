#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 ./prepare-operations-env.py --check
export COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"
python3 ./prepare-findhub-env.py --env-file .env --check
docker compose --env-file .env -f docker-compose.yaml config --quiet
