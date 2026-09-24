#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 ./prepare-env.py --check
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml pull
python3 ./prepare-volumes.py
docker compose --env-file .env -f compose.yaml up -d --pull never
python3 ./check-runtime.py
