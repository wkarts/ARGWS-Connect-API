#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 ./prepare-env.py --check
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml pull
python3 ./prepare-volumes.py --compose-file compose.yaml
if docker compose --env-file .env -f compose.yaml ps -q 2>/dev/null | grep -q .; then
  echo "Criando backup Connect|API antes da atualizacao..."
  BACKUP_FILE="$(./backup.sh)"
  ./verify-backup.sh "$BACKUP_FILE"
fi
docker compose --env-file .env -f compose.yaml up -d --pull never
python3 ./check-runtime.py --expected 14
