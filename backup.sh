#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec ./scripts/connect-stack-backup.sh backup --stack-dir . --compose-file docker-compose.yaml
