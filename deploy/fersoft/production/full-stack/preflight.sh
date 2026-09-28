#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 ./prepare-env.py --check
docker compose --env-file .env -f compose.yaml config --quiet
echo "Preflight Fersoft full stack concluido."
