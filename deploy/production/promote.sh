#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Uso: ./promote.sh X.Y.Z" >&2
  echo "Este comando aplica uma versão canonical sobre a mesma stack de produção." >&2
  exit 1
fi

export ARGWS_CONNECT_CANONICAL_VERSION="$version"
exec bash ../canonical/deploy.sh
