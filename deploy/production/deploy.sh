#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./prepare-env.sh
mkdir -p ./volumes/{instances,manager,postgres,redis,rabbitmq,minio,nats,kafka,zookeeper/data,zookeeper/log,logs,backups}
./preflight.sh
docker compose --env-file .env -f compose.yaml pull
if ! docker compose --env-file .env -f compose.yaml up -d --remove-orphans; then
  echo "ERRO: falha ao iniciar a stack. Estado e logs recentes:" >&2
  docker compose --env-file .env -f compose.yaml ps || true
  docker compose --env-file .env -f compose.yaml logs --tail=200 || true
  exit 1
fi
docker compose --env-file .env -f compose.yaml ps
echo "API: https://api.connect.argws.com.br"
echo "Manager: https://api.connect.argws.com.br/manager"
echo "Health: https://api.connect.argws.com.br/health"
echo "DOCs local: http://127.0.0.1:38180"
