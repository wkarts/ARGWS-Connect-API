#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Uso: ./promote.sh X.Y.Z" >&2
  exit 1
fi

./prepare-env.sh

image="ghcr.io/wkarts/argws-connect-api:${version}"
current="$(grep -E '^ARGWS_CONNECT_API_IMAGE=' .env | tail -n1 | cut -d= -f2-)"

if [[ "$current" == "$image" ]]; then
  echo "Produção já está em ${image}."
  exit 0
fi

echo "Validando imagem promovida: ${image}"
if ! docker manifest inspect "$image" >/dev/null 2>&1; then
  echo "ERRO: imagem versionada não encontrada ou sem permissão: ${image}" >&2
  echo "Execute ./registry-login.sh se o package GHCR for privado." >&2
  exit 1
fi

backup=".env.before-promotion"
cp .env "$backup"
chmod 600 "$backup"

python3 - "$image" <<'PY'
from pathlib import Path
import sys

path = Path('.env')
image = sys.argv[1]
lines = path.read_text().splitlines()
found = False
out = []
for line in lines:
    if line.startswith('ARGWS_CONNECT_API_IMAGE='):
        out.append(f'ARGWS_CONNECT_API_IMAGE={image}')
        found = True
    else:
        out.append(line)
if not found:
    raise SystemExit('ARGWS_CONNECT_API_IMAGE não encontrado no .env')
path.write_text('\n'.join(out) + '\n')
PY

if ./update.sh; then
  rm -f "$backup"
  echo "Promoção concluída: ${current} -> ${image}"
  exit 0
fi

echo "ERRO: promoção falhou. Restaurando ${current}." >&2
mv "$backup" .env
chmod 600 .env
./update.sh || true
exit 1
