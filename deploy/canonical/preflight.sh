#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f ../production/.env ]]; then
  echo "ERRO: ../production/.env inexistente. Execute ./deploy.sh ou ../production/prepare-env.sh."
  exit 1
fi

version="${ARGWS_CONNECT_CANONICAL_VERSION:-}"
if [[ -z "$version" ]]; then
  version="$(grep -E '^ARGWS_CONNECT_CANONICAL_VERSION=' env.example | tail -n1 | cut -d= -f2-)"
fi
if [[ -z "$version" ]]; then
  version="$(tr -d '[:space:]' < ../../VERSION)"
fi
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERRO: versão canonical inválida: ${version:-<vazia>}"
  exit 1
fi

image="ghcr.io/wkarts/argws-connect-api:${version}"
if [[ -n "${ARGWS_CONNECT_API_IMAGE:-}" && "$ARGWS_CONNECT_API_IMAGE" != "$image" ]]; then
  echo "ERRO: ARGWS_CONNECT_API_IMAGE diverge da versão canonical ${version}."
  exit 1
fi
export ARGWS_CONNECT_API_IMAGE="$image"

echo "Verificando ${image}..."
if ! docker manifest inspect "$image" >/dev/null 2>&1; then
  echo "ERRO: imagem canonical indisponível ou sem permissão: ${image}"
  echo "Execute ../production/registry-login.sh se o GHCR estiver privado."
  exit 1
fi

docker compose --env-file ../production/.env \
  -f ../production/compose.yaml -f compose.yaml config >/dev/null

docker compose --profile '*' --env-file ../production/.env \
  -f ../production/compose.yaml -f compose.yaml config >/dev/null

echo "Preflight canonical concluído. Stable=${version}; mesma porta/rede/volumes da produção."
