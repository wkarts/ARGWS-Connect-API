#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || { echo "ERRO: .env inexistente. Copie env.example para .env."; exit 1; }
get_value() { grep -E "^${1}=" .env | tail -n1 | cut -d= -f2-; }
image="$(get_value ARGWS_CONNECT_DOCS_IMAGE)"
[[ -n "$image" ]] || { echo "ERRO: ARGWS_CONNECT_DOCS_IMAGE não definido."; exit 1; }
echo "Verificando ${image}..."
docker manifest inspect "$image" >/dev/null 2>&1 || { echo "ERRO: imagem indisponível: ${image}"; exit 1; }
docker compose --env-file .env -f compose.yaml config >/dev/null
echo "Preflight Connect|API DOCs concluído."
