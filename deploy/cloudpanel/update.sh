#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose config >/dev/null
docker compose pull
docker compose up -d --remove-orphans
docker compose ps
