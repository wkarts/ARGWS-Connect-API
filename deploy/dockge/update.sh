#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./prepare-env.sh
export COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml pull
if docker compose --env-file .env -f compose.yaml ps -q | grep -q .; then
  echo "Criando e verificando backup antes da atualizacao (aguarde janela sem chamadas)."
  BACKUP_FILE="$(bash ./backup.sh)"
  bash ./verify-backup.sh "$BACKUP_FILE"
fi
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml ps
