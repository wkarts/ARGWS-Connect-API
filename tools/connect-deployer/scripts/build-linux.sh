#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-build.txt
python scripts/prepare_build.py
python -m unittest discover -s tests -v
python -m PyInstaller --clean --noconfirm connect-deploy.spec
python scripts/smoke_binary.py
python scripts/package_artifact.py
printf '\nPacote concluído: %s/dist/release\n' "$PWD"
