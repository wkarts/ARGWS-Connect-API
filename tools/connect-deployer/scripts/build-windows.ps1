$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw 'Python Launcher (py.exe) não encontrado. Instale Python 3.12.'
}
py -3.12 -m venv .venv
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar ambiente de build.' }
function Invoke-BuildPython {
    & .\.venv\Scripts\python.exe @args
    if ($LASTEXITCODE -ne 0) { throw "Build interrompido (exit $LASTEXITCODE)." }
}
Invoke-BuildPython -m pip install --upgrade pip
Invoke-BuildPython -m pip install -r requirements-build.txt
Invoke-BuildPython scripts/prepare_build.py
Invoke-BuildPython -m unittest discover -s tests -v
Invoke-BuildPython -m PyInstaller --clean --noconfirm connect-deploy.spec
Invoke-BuildPython scripts/smoke_binary.py
Invoke-BuildPython scripts/package_artifact.py
Write-Host "Pacote concluído: $PWD\dist\release"
