#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[[ -f .env ]] || { echo "ERRO: .env inexistente. Execute ./prepare-env.sh."; exit 1; }

get_value() { grep -E "^${1}=" .env | tail -n1 | cut -d= -f2-; }
required=(POSTGRES_PASSWORD REDIS_PASSWORD RABBITMQ_DEFAULT_PASS MINIO_ROOT_PASSWORD AUTHENTICATION_API_KEY METRICS_PASSWORD WA_BUSINESS_TOKEN_WEBHOOK)
for key in "${required[@]}"; do
  value="$(get_value "$key")"
  [[ -n "$value" && "$value" != CHANGE_ME* ]] || { echo "ERRO: configure ${key} no .env."; exit 1; }
done

api_image="$(get_value ARGWS_CONNECT_API_IMAGE)"
[[ "$api_image" == "ghcr.io/wkarts/argws-connect-api:develop" ]] || { echo "ERRO: develop deve usar :develop."; exit 1; }

if command -v sysctl >/dev/null 2>&1; then
  overcommit="$(sysctl -n vm.overcommit_memory 2>/dev/null || true)"
  if [[ "$overcommit" != "1" ]]; then
    echo "AVISO: Redis recomenda vm.overcommit_memory=1 no host."
    echo "Execute: sudo sysctl -w vm.overcommit_memory=1"
  fi
fi

image_vars=(ARGWS_CONNECT_API_IMAGE ARGWS_CONNECT_POSTGRES_IMAGE ARGWS_CONNECT_REDIS_IMAGE ARGWS_CONNECT_RABBITMQ_IMAGE ARGWS_CONNECT_MINIO_IMAGE)
profiles=",$(get_value COMPOSE_PROFILES),"
[[ "$profiles" == *,nats,* || "$profiles" == *,extended,* ]] && image_vars+=(ARGWS_CONNECT_NATS_IMAGE)
[[ "$profiles" == *,kafka,* || "$profiles" == *,extended,* ]] && image_vars+=(ARGWS_CONNECT_KAFKA_IMAGE ARGWS_CONNECT_ZOOKEEPER_IMAGE)
for key in "${image_vars[@]}"; do
  image="$(get_value "$key")"
  [[ -n "$image" ]] || { echo "ERRO: ${key} nao definido."; exit 1; }
  echo "Verificando ${image}..."
  docker manifest inspect "$image" >/dev/null 2>&1 || { echo "ERRO: imagem indisponivel: ${image}"; exit 1; }
done

docker compose --env-file .env -f compose.yaml config >/dev/null
docker compose --env-file .env --profile '*' -f compose.yaml config >/dev/null
echo "Preflight develop concluido. Imagem: ${api_image}."
