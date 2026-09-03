#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/deploy/platform/.env}"
EXAMPLE="$ROOT_DIR/deploy/platform/env.example"
if [[ -e "$ENV_FILE" ]]; then
  echo "Já existe: $ENV_FILE"
  exit 0
fi
cp "$EXAMPLE" "$ENV_FILE"
VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
python3 - "$ENV_FILE" "$VERSION" <<'PY'
from pathlib import Path
import sys
path=Path(sys.argv[1]); version=sys.argv[2]
text=path.read_text(encoding='utf-8')
text=text.replace('CONNECT_API_VERSION=1.0.16', f'CONNECT_API_VERSION={version}')
path.write_text(text,encoding='utf-8')
PY
echo "Criado: $ENV_FILE"
echo "Edite os CHANGE_ME antes do primeiro deploy."
