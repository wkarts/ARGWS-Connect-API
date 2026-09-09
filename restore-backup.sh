#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ $# -eq 1 ]] || { echo "Uso: $0 arquivo.connectbak" >&2; exit 2; }
exec ./scripts/connect-stack-backup.sh restore --stack-dir . --compose-file docker-compose.yaml --file "$1"
