#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

./prepare-env.sh

mkdir -p \
  ./volumes/instances \
  ./volumes/manager \
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

chmod 700 ./volumes/manager 2>/dev/null || true
./preflight.sh

docker compose -f compose.yaml pull
if ! docker compose -f compose.yaml up -d --remove-orphans; then
  echo "ERRO: falha ao iniciar a stack. Estado e logs recentes:" >&2
  docker compose -f compose.yaml ps || true
  docker compose -f compose.yaml logs --tail=200 || true
  exit 1
fi
docker compose -f compose.yaml ps

echo
port="$(grep -E '^ARGWS_CONNECT_API_HOST_PORT=' .env | tail -n1 | cut -d= -f2-)"
echo "API local: http://127.0.0.1:${port:-38081}"
echo "API publica: https://h.api.connect.argws.com.br"
echo "Manager: https://h.api.connect.argws.com.br/manager"
echo "Health: https://h.api.connect.argws.com.br/health"
echo "DOCs local: http://127.0.0.1:38181"
