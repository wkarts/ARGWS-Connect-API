#!/usr/bin/env bash
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy.sh" "${1:-${CONNECT_DEPLOYMENT_PROFILE:-platform}}"
