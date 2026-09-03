#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-${CONNECT_DEPLOYMENT_PROFILE:-platform}}"
case "$PROFILE" in
  api)      COMPOSE_ARGS=() ;;
  docs)     COMPOSE_ARGS=(--profile docs) ;;
  platform) COMPOSE_ARGS=(--profile platform) ;;
  *) echo "Perfil inválido: $PROFILE. Use api, docs ou platform." >&2; exit 2 ;;
esac
export PROFILE
# shellcheck disable=SC2034
export COMPOSE_ARGS_SERIALIZED="${COMPOSE_ARGS[*]-}"
