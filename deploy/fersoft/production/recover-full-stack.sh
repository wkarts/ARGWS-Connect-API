#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 ./prepare-operations-env.py --check
export COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"
docker compose --env-file .env -f compose.yaml config --quiet
expected="$(docker compose --env-file .env -f compose.yaml config --services | wc -l | tr -d '[:space:]')"
[[ "$expected" == "14" ]] || { echo "ERRO: esta recuperacao requer os 14 servicos locais selecionados no .env." >&2; exit 2; }
docker compose --env-file .env -f compose.yaml pull
# Stop only the three auxiliary services whose bind permissions are checked below.
docker compose --env-file .env -f compose.yaml stop mysql-fersoft-connect-production kafka-fersoft-connect-production zookeeper-fersoft-connect-production || true
python3 ./prepare-volumes.py --compose-file compose.yaml
docker compose --env-file .env -f compose.yaml up -d --pull never
python3 ./check-runtime.py --expected 14
