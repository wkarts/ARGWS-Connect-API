#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./prepare-env.sh
export COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"
mkdir -p ./volumes/{instances,postgres,redis,rabbitmq,minio,nats,kafka,zookeeper/data,zookeeper/log,logs,backups}
./preflight.sh
docker compose --env-file .env -f compose.yaml pull
python3 ./prepare-volumes.py --compose-file compose.yaml
docker compose --env-file .env -f compose.yaml up -d --remove-orphans
docker compose --env-file .env -f compose.yaml ps
echo "API: https://d.api.connect.fersofterp.com.br"
echo "Manager: https://d.api.connect.fersofterp.com.br/manager"
echo "Health: https://d.api.connect.fersofterp.com.br/health"
