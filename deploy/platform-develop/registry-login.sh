#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GHCR_USERNAME:-}" || -z "${GHCR_TOKEN:-}" ]]; then
  echo "Defina GHCR_USERNAME e GHCR_TOKEN para autenticar no ghcr.io." >&2
  exit 1
fi

printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
