#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

../production/prepare-env.sh

version="$(grep -E '^ARGWS_CONNECT_CANONICAL_VERSION=' env.example | tail -n1 | cut -d= -f2-)"
if [[ -z "$version" ]]; then
  version="$(tr -d '[:space:]' < ../../VERSION)"
fi
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERRO: versão canonical inválida: ${version:-<vazia>}"
  exit 1
fi

export ARGWS_CONNECT_API_IMAGE="ghcr.io/wkarts/argws-connect-api:${version}"
./preflight.sh

docker compose --env-file ../production/.env \
  -f ../production/compose.yaml -f compose.yaml pull

docker compose --env-file ../production/.env \
  -f ../production/compose.yaml -f compose.yaml up -d --remove-orphans

docker compose --env-file ../production/.env \
  -f ../production/compose.yaml -f compose.yaml ps

echo
echo "Canonical production ativo na mesma stack de produção."
echo "Versão: ${version}"
echo "API: https://api.connect.argws.com.br"
echo "Porta local: 127.0.0.1:38080"
