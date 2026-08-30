#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo "Arquivo .env criado a partir de .env.example."
  echo "Edite os valores CHANGE_ME_* antes de continuar."
  exit 1
fi

required=(POSTGRES_PASSWORD REDIS_PASSWORD AUTHENTICATION_API_KEY)
for key in "${required[@]}"; do
  value="$(grep -E "^${key}=" .env | tail -n1 | cut -d= -f2-)"
  if [[ -z "$value" || "$value" == CHANGE_ME* ]]; then
    echo "ERRO: configure ${key} no .env."
    exit 1
  fi
done

docker compose pull
docker compose up -d --remove-orphans
docker compose ps
