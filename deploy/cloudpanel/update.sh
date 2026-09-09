#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./prepare-env.sh
export COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"
docker compose config >/dev/null
docker compose pull
# Backup de segurança antes da atualização. Em instalação nova não há estado para salvar.
if docker compose --env-file .env -f docker-compose.yml ps -q 2>/dev/null | grep -q .; then
  echo "Criando backup Connect|API antes da atualização..."
  BACKUP_FILE="$(./backup.sh)"
  ./verify-backup.sh "$BACKUP_FILE"
  echo "Backup validado: $BACKUP_FILE"
fi
docker compose up -d --remove-orphans
docker compose ps
