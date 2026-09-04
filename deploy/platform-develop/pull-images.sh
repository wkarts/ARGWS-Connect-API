#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="$ROOT_DIR/deploy/platform-develop"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env}"
COMPOSE_FILE="$STACK_DIR/compose.yaml"

[[ -f "$ENV_FILE" ]] || { echo "Ambiente ausente: $ENV_FILE" >&2; exit 1; }

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
mapfile -t images < <("${compose[@]}" config --images | awk 'NF' | sort -u)
((${#images[@]} > 0)) || { echo "Nenhuma imagem encontrada no Compose renderizado." >&2; exit 1; }

failures=()
for image in "${images[@]}"; do
  echo "[PULL] $image"
  if output="$(docker pull "$image" 2>&1)"; then
    printf '%s\n' "$output" | tail -n 1
  else
    printf '%s\n' "$output" >&2
    failures+=("$image")
  fi
done

if ((${#failures[@]} > 0)); then
  echo >&2
  echo "Falha ao resolver ${#failures[@]} imagem(ns):" >&2
  printf '  - %s\n' "${failures[@]}" >&2
  echo "Confirme a publicação da tag, a visibilidade do package e o login no GHCR." >&2
  exit 1
fi

echo "Todas as ${#images[@]} imagens foram resolvidas e baixadas individualmente."
