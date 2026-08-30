#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp env.example .env
  chmod 600 .env
  echo "Arquivo .env criado a partir de env.example."
  echo "Configure os valores CHANGE_ME_* e execute novamente."
  exit 1
fi

mkdir -p \
  ./volumes/instances \
  ./volumes/postgres \
  ./volumes/redis \
  ./volumes/rabbitmq \
  ./volumes/minio \
  ./volumes/mysql \
  ./volumes/nats \
  ./volumes/kafka \
  ./volumes/zookeeper/data \
  ./volumes/zookeeper/log \
  ./volumes/logs \
  ./volumes/backups

./preflight.sh

docker compose -f compose.yaml pull
docker compose -f compose.yaml up -d --remove-orphans
docker compose -f compose.yaml ps

echo
port="$(grep -E '^ARGWS_CONNECT_API_HOST_PORT=' .env | tail -n1 | cut -d= -f2-)"
echo "API: http://127.0.0.1:${port:-38081}"
echo "Manager: http://127.0.0.1:${port:-38081}/manager"
echo "Health: http://127.0.0.1:${port:-38081}/health"
