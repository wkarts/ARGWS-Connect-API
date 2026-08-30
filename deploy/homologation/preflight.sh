#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "ERRO: .env inexistente. Copie env.example para .env e configure os segredos."
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

image_vars=(
  ARGWS_CONNECT_API_IMAGE
  ARGWS_CONNECT_POSTGRES_IMAGE
  ARGWS_CONNECT_REDIS_IMAGE
  ARGWS_CONNECT_RABBITMQ_IMAGE
  ARGWS_CONNECT_MINIO_IMAGE
)

for key in "${image_vars[@]}"; do
  image="$(get_value "$key")"
  if [[ -z "$image" ]]; then
    echo "ERRO: ${key} nao definido."
    exit 1
  fi
  echo "Verificando ${image}..."
  if ! docker manifest inspect "$image" >/dev/null 2>&1; then
    echo "ERRO: imagem indisponivel ou sem permissao: ${image}"
    echo "Execute ./registry-login.sh. Se persistir 'manifest unknown', execute o bootstrap GHCR no repositorio."
    exit 1
  fi
done

docker compose -f compose.yaml config >/dev/null

echo "Preflight concluido com sucesso."
