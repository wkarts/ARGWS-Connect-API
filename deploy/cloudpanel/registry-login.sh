#!/usr/bin/env bash
set -euo pipefail
GHCR_USERNAME="${GHCR_USERNAME:-wkarts}"
if [[ -z "${GHCR_TOKEN:-}" ]]; then
  echo "Defina GHCR_TOKEN com um PAT que tenha read:packages."
  echo "Exemplo: GHCR_USERNAME=wkarts GHCR_TOKEN='...' ./registry-login.sh"
  exit 1
fi
printf '%s' "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin
unset GHCR_TOKEN
echo "Login no GHCR concluido."
