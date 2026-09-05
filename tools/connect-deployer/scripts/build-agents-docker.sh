#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p src-tauri/embedded

docker run --rm --platform linux/amd64 -v "$ROOT:/work" -w /work rust:1.90-bookworm \
  bash -lc 'apt-get update && apt-get install -y musl-tools && rustup target add x86_64-unknown-linux-musl && export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc CC_x86_64_unknown_linux_musl=musl-gcc && cargo build -p connect-deploy-agent --release --target x86_64-unknown-linux-musl && cp target/x86_64-unknown-linux-musl/release/connect-deploy-agent src-tauri/embedded/agent-linux-amd64'

docker run --rm --platform linux/arm64 -v "$ROOT:/work" -w /work rust:1.90-bookworm \
  bash -lc 'apt-get update && apt-get install -y musl-tools && rustup target add aarch64-unknown-linux-musl && export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc CC_aarch64_unknown_linux_musl=musl-gcc && cargo build -p connect-deploy-agent --release --target aarch64-unknown-linux-musl && cp target/aarch64-unknown-linux-musl/release/connect-deploy-agent src-tauri/embedded/agent-linux-arm64'
