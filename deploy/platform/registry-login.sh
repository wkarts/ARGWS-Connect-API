#!/usr/bin/env bash
set -euo pipefail
REGISTRY="${GHCR_REGISTRY:-ghcr.io}"
USER="${GHCR_USER:-${GITHUB_ACTOR:-}}"
TOKEN="${GHCR_TOKEN:-${GITHUB_TOKEN:-}}"
[[ -n "$USER" && -n "$TOKEN" ]] || { echo "Defina GHCR_USER/GHCR_TOKEN." >&2; exit 1; }
printf '%s' "$TOKEN" | docker login "$REGISTRY" -u "$USER" --password-stdin
