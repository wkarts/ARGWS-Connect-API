#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "ERRO: .env inexistente. Execute ./prepare-env.sh."
  exit 1
fi

required=(
  POSTGRES_PASSWORD
  REDIS_PASSWORD
  RABBITMQ_DEFAULT_PASS
  MINIO_ROOT_PASSWORD
  AUTHENTICATION_API_KEY
  METRICS_PASSWORD
  WA_BUSINESS_TOKEN_WEBHOOK
)

get_value() {
  grep -E "^${1}=" .env | tail -n1 | cut -d= -f2-
}

for key in "${required[@]}"; do
  value="$(get_value "$key")"
  if [[ -z "$value" || "$value" == CHANGE_ME* ]]; then
    echo "ERRO: configure ${key} no .env."
    exit 1
  fi
done

api_image="$(get_value ARGWS_CONNECT_API_IMAGE)"
if [[ "$api_image" != "ghcr.io/wkarts/argws-connect-api:latest" ]]; then
  echo "ERRO: o deployment normal de producao deve usar exclusivamente :latest."
  echo "Imagem atual: ${api_image:-<vazia>}"
  echo "Para uma versao pinada use deploy/canonical."
  exit 1
fi

image_vars=(
  ARGWS_CONNECT_API_IMAGE
  ARGWS_CONNECT_POSTGRES_IMAGE
  ARGWS_CONNECT_REDIS_IMAGE
  ARGWS_CONNECT_RABBITMQ_IMAGE
  ARGWS_CONNECT_MINIO_IMAGE
)

profiles=",$(get_value COMPOSE_PROFILES),"
if [[ "$profiles" == *,nats,* || "$profiles" == *,extended,* ]]; then
  image_vars+=(ARGWS_CONNECT_NATS_IMAGE)
fi
if [[ "$profiles" == *,kafka,* || "$profiles" == *,extended,* ]]; then
  image_vars+=(ARGWS_CONNECT_KAFKA_IMAGE ARGWS_CONNECT_ZOOKEEPER_IMAGE)
fi

for key in "${image_vars[@]}"; do
  image="$(get_value "$key")"
  if [[ -z "$image" ]]; then
    echo "ERRO: ${key} nao definido."
    exit 1
  fi
  echo "Verificando ${image}..."
  if ! docker manifest inspect "$image" >/dev/null 2>&1; then
    echo "ERRO: imagem indisponivel ou sem permissao: ${image}"
    echo "Execute ./registry-login.sh. Se persistir 'manifest unknown', verifique o espelhamento GHCR."
    exit 1
  fi
done

docker compose -f compose.yaml config >/dev/null
docker compose --profile '*' -f compose.yaml config >/dev/null

echo "Preflight de producao concluido. Canal: latest. Profiles: ${COMPOSE_PROFILES:-core}"
