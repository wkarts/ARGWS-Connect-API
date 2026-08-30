#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

./prepare-env.sh

mkdir -p \
  ./volumes/instances \
  ./volumes/postgres \
  ./volumes/redis \
  ./volumes/rabbitmq \
  ./volumes/minio \
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
echo "API local: http://127.0.0.1:${port:-38080}"
echo "API publica: https://api.connect.argws.com.br"
echo "Manager: https://api.connect.argws.com.br/manager"
echo "Health: https://api.connect.argws.com.br/health"
