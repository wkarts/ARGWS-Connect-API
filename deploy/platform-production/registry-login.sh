#!/usr/bin/env bash
set -euo pipefail
REGISTRY="${GHCR_REGISTRY:-ghcr.io}"
USER="${GHCR_USERNAME:-${GITHUB_ACTOR:-wkarts}}"
TOKEN="${GHCR_TOKEN:-${GITHUB_TOKEN:-}}"
[[ -n "$TOKEN" ]] || { echo "Defina GHCR_TOKEN ou GITHUB_TOKEN." >&2; exit 1; }
printf '%s' "$TOKEN" | docker login "$REGISTRY" -u "$USER" --password-stdin
