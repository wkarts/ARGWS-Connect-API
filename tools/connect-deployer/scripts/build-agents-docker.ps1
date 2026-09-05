param(
  [switch]$Amd64Only,
  [switch]$Arm64Only
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
  docker version | Out-Null
  New-Item -ItemType Directory -Force -Path "src-tauri/embedded" | Out-Null

  if (-not $Arm64Only) {
    Write-Host "Building Linux amd64 static agent..."
    docker run --rm --platform linux/amd64 `
      -v "${Root}:/work" -w /work rust:1.90-bookworm `
      bash -lc "apt-get update && apt-get install -y musl-tools && rustup target add x86_64-unknown-linux-musl && export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc CC_x86_64_unknown_linux_musl=musl-gcc && cargo build -p connect-deploy-agent --release --target x86_64-unknown-linux-musl && cp target/x86_64-unknown-linux-musl/release/connect-deploy-agent src-tauri/embedded/agent-linux-amd64"
  }

  if (-not $Amd64Only) {
    Write-Host "Building Linux arm64 static agent (Docker Desktop precisa suportar linux/arm64)..."
    docker run --rm --platform linux/arm64 `
      -v "${Root}:/work" -w /work rust:1.90-bookworm `
      bash -lc "apt-get update && apt-get install -y musl-tools && rustup target add aarch64-unknown-linux-musl && export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc CC_aarch64_unknown_linux_musl=musl-gcc && cargo build -p connect-deploy-agent --release --target aarch64-unknown-linux-musl && cp target/aarch64-unknown-linux-musl/release/connect-deploy-agent src-tauri/embedded/agent-linux-arm64"
  }
} finally {
  Pop-Location
}
