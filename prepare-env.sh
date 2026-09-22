#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v python3 >/dev/null 2>&1 || { echo "ERRO: python3 necessario para preparar o ambiente com seguranca."; exit 1; }
python3 ./prepare-operations-env.py --env-file .env --template env.example "$@"
if ! python3 ./prepare-findhub-env.py --env-file .env "$@"; then
  echo "AVISO: Find Hub requer ajuste de configuracao; outros canais nao foram bloqueados. Nenhuma chave invalida foi substituida." >&2
fi
