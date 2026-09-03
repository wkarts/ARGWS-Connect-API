#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
source "$ROOT/scripts/deploy/lib.sh"
[[ -f .env ]] || die ".env não encontrado"
require_cmd docker
compose_cmd .env run --rm connect-api python -m app.cli backup
