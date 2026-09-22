#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 ./prepare-operations-env.py --check
export COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"
if ! python3 ./prepare-findhub-env.py --env-file .env --check; then
  echo "AVISO: Find Hub indisponivel ate corrigir sua configuracao. A validacao dos demais canais continua." >&2
fi
docker compose --env-file .env -f docker-compose.yml config --quiet
