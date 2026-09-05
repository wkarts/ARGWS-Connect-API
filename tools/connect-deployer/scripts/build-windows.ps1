param(
  [switch]$SkipAgents,
  [switch]$Amd64Only
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
  if (-not $SkipAgents) {
    if ($Amd64Only) { & "$PSScriptRoot/build-agents-docker.ps1" -Amd64Only }
    else { & "$PSScriptRoot/build-agents-docker.ps1" }
  }
  if (-not (Test-Path "src-tauri/embedded/agent-linux-amd64")) {
    throw "Agente Linux amd64 ausente. Execute scripts/build-agents-docker.ps1 ou baixe os agentes do GitHub Actions."
  }
  npm install --no-audit --no-fund
  npm run build
  cargo check -p argws-connect-deployer-desktop
  npm run tauri:build
  node scripts/collect-release.mjs windows-x64
  Write-Host "Build concluido em dist/release"
} finally {
  Pop-Location
}
