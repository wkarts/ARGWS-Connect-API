#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo "Arquivo .env criado a partir de .env.example."
  echo "Configure todos os valores CHANGE_ME_* antes de continuar."
  exit 1
fi

read_env() {
  local key="$1"
  grep -E "^${key}=" .env | tail -n1 | cut -d= -f2-
}

required=(POSTGRES_PASSWORD REDIS_PASSWORD RABBITMQ_DEFAULT_PASS MINIO_ROOT_PASSWORD AUTHENTICATION_API_KEY METRICS_PASSWORD)
for key in "${required[@]}"; do
  value="$(read_env "$key")"
  if [[ -z "$value" || "$value" == CHANGE_ME* ]]; then
    echo "ERRO: configure ${key} no .env."
    exit 1
  fi
done

if grep -Eq '^[A-Z0-9_]+=.*CHANGE_ME' .env; then
  echo "ERRO: ainda existem valores CHANGE_ME_* ativos no .env."
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

docker compose config >/dev/null

if [[ -n "${GHCR_TOKEN:-}" ]]; then
  GHCR_USERNAME="${GHCR_USERNAME:-wkarts}" GHCR_TOKEN="${GHCR_TOKEN}" ./registry-login.sh
fi

echo "Validando acesso as imagens GHCR..."
while IFS= read -r image; do
  [[ -z "$image" ]] && continue
  if ! docker manifest inspect "$image" >/dev/null 2>&1; then
    echo "ERRO: nao foi possivel acessar $image"
    echo "Se o package estiver privado, execute ./registry-login.sh com GHCR_TOKEN de read:packages."
    exit 1
  fi
done < <(docker compose config --images)

docker compose pull
docker compose up -d --remove-orphans

echo "Stack iniciada. Somente a porta da API e publicada no host."
docker compose ps
