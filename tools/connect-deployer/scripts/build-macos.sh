#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ "${1:-}" != "--skip-agents" ]]; then
  ./scripts/build-agents-docker.sh
fi
npm install --no-audit --no-fund
npm run build
cargo check -p argws-connect-deployer-desktop
npm run tauri:build
node scripts/collect-release.mjs macos-local
