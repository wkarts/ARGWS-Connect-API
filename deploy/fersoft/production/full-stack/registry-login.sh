#!/usr/bin/env bash
set -euo pipefail

read -rp "GitHub username: " GHCR_USERNAME
read -rsp "GitHub PAT (read:packages): " GHCR_TOKEN
echo

if [[ -z "${GHCR_USERNAME}" || -z "${GHCR_TOKEN}" ]]; then
  echo "ERRO: username e token sao obrigatorios."
  exit 1
fi

echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin
unset GHCR_TOKEN

echo "Login no GHCR concluido."
