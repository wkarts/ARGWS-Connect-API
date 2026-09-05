# Build-machine preflight only. Never runs on the deployment VPS.
[CmdletBinding()]
param(
    [string]$PerlPath = 'C:\Strawberry\perl\bin\perl.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) {
    throw 'This preflight requires native Windows PowerShell 7.'
}
if (-not (Test-Path -LiteralPath $PerlPath -PathType Leaf)) {
    throw "Native Strawberry Perl not found: $PerlPath. Install it on the build machine, not the VPS."
}
$PerlPath = (Resolve-Path -LiteralPath $PerlPath).Path

# Git Bash prepends its MSYS Perl. It is not a valid interpreter for VC-WIN64A.
# Test the exact executable AND the modules required by the locked OpenSSL source.
& $PerlPath -MConfig -MIPC::Cmd -MLocale::Maketext::Simple -e 'die q(Native MSWin32 Perl required) unless $^O eq q(MSWin32); print qq(Perl $^V $Config{archname}\n);'
if ($LASTEXITCODE -ne 0) {
    throw 'Perl preflight failed: native MSWin32, IPC::Cmd and Locale::Maketext::Simple are required.'
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
    throw 'Visual Studio Build Tools with the x64 C++ workload are required on the build machine.'
}
$nmakePaths = @(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'VC\Tools\MSVC\**\bin\Hostx64\x64\nmake.exe')
if ($LASTEXITCODE -ne 0 -or $nmakePaths.Count -eq 0) {
    throw 'The native MSVC x64 NMake toolchain was not found.'
}
$nmake = $nmakePaths[0].Trim()
$compiler = Join-Path (Split-Path -Parent $nmake) 'cl.exe'
if (-not (Test-Path -LiteralPath $nmake -PathType Leaf) -or -not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    throw 'MSVC x64 compiler or NMake executable is missing.'
}

# openssl-src honors OPENSSL_SRC_PERL before PERL. Set both to an absolute path.
# cc discovers MSVC through vswhere; never substitute MinGW for the MSVC target.
$env:PERL = $PerlPath
$env:OPENSSL_SRC_PERL = $PerlPath
$perlDirectory = Split-Path -Parent $PerlPath
$env:PATH = "$perlDirectory;$env:PATH"
if ($env:GITHUB_ENV) {
    "PERL=$PerlPath" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
    "OPENSSL_SRC_PERL=$PerlPath" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
}
if ($env:GITHUB_PATH) {
    $perlDirectory | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
}
Write-Host "Native Windows OpenSSL preflight passed. Perl=$PerlPath; MSVC=$compiler; NMake=$nmake"
