#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || { echo "ERRO: .env inexistente. Copie env.example para .env."; exit 1; }
get_value() { grep -E "^${1}=" .env | tail -n1 | cut -d= -f2-; }
image="$(get_value ARGWS_CONNECT_DOCS_IMAGE)"
url="$(get_value ARGWS_CONNECT_DOCS_PUBLIC_URL)"
[[ "$image" == "ghcr.io/wkarts/argws-connect-docs:develop" ]] || { echo "ERRO: DOCs develop deve usar :develop."; exit 1; }
[[ "$url" == "https://d.docs.connect.argws.com.br" ]] || { echo "ERRO: URL pública estável inválida: ${url}"; exit 1; }
docker manifest inspect "$image" >/dev/null 2>&1 || { echo "ERRO: imagem indisponível: ${image}"; exit 1; }
docker compose --env-file .env -f compose.yaml config >/dev/null
echo "Preflight Connect|API DOCs develop concluído."
