#!/usr/bin/env bash
# Instalador compatível com o fluxo CloudPanel + Dockge usado nos projetos Connect|API.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/deployments/cloudpanel/install.sh" "$@"
