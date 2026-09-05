$ErrorActionPreference = 'Stop'

function Require-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name não encontrado. $Hint"
    }
}

Write-Host "ARGWS Connect Deployer - validação do ambiente Windows" -ForegroundColor Cyan
Require-Command node "Instale Node.js 22 LTS."
Require-Command npm "O npm deve acompanhar o Node.js 22."
Require-Command cargo "Instale Rust via rustup (toolchain 1.90.0)."
Require-Command rustc "Instale Rust via rustup."
Require-Command docker "Docker Desktop é necessário apenas para compilar localmente os agentes Linux."

$nodeVersion = (& node --version).Trim()
$rustVersion = (& rustc --version).Trim()
$dockerVersion = (& docker --version).Trim()
Write-Host "Node:   $nodeVersion"
Write-Host "Rust:   $rustVersion"
Write-Host "Docker: $dockerVersion"

& rustup toolchain install 1.90.0 --profile minimal --component rustfmt,clippy
& rustup override set 1.90.0

Write-Host "Ambiente pronto. Execute .\scripts\build-windows.ps1" -ForegroundColor Green
