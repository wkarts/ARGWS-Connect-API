#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="$ROOT_DIR/deploy/platform"
ENV_FILE="${1:-$STACK_DIR/.env}"
EXAMPLE="$STACK_DIR/env.example"

[[ -f "$EXAMPLE" ]] || { echo "ERRO: env.example não encontrado: $EXAMPLE" >&2; exit 1; }

created=0
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE" "$ENV_FILE"
  created=1
  echo ".env criado a partir do env.example completo."
else
  echo ".env existente encontrado; valores atuais serão preservados."
fi

CREATED="$created" python3 - "$ENV_FILE" "$EXAMPLE" "$ROOT_DIR/VERSION" <<'PYENV'
from __future__ import annotations
import os
import re
import secrets
import sys
from pathlib import Path

path = Path(sys.argv[1])
template_path = Path(sys.argv[2])
version_file = Path(sys.argv[3])
text = path.read_text(encoding="utf-8")
template = template_path.read_text(encoding="utf-8")
assignment = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
existing: dict[str, str] = {}
extras: list[str] = []
for raw in text.splitlines():
    match = assignment.match(raw)
    if match:
        existing[match.group(1)] = match.group(2)
    elif raw.strip() and not raw.lstrip().startswith("#"):
        extras.append(raw)

rendered: list[str] = []
template_keys: set[str] = set()
for raw in template.splitlines():
    match = assignment.match(raw)
    if not match:
        rendered.append(raw)
        continue
    key, default = match.group(1), match.group(2)
    template_keys.add(key)
    rendered.append(f"{key}={existing.get(key, default)}")

extra_keys = sorted(set(existing) - template_keys)
if extra_keys or extras:
    rendered += ["", "# --------------------------------------------------------------------------", "# Variáveis locais preservadas", "# --------------------------------------------------------------------------"]
    rendered += [f"{key}={existing[key]}" for key in extra_keys]
    rendered += extras

result = "\n".join(rendered).rstrip() + "\n"
if version_file.exists():
    version = version_file.read_text(encoding="utf-8").strip()
    result = re.sub(r"^CONNECT_API_VERSION=.*$", f"CONNECT_API_VERSION={version}", result, flags=re.M)

placeholders = sorted(set(re.findall(r"CHANGE_ME_[A-Z0-9_]+", result)))
for placeholder in placeholders:
    size = 48 if "API_KEY" in placeholder else 40 if "TOKEN" in placeholder else 32
    result = result.replace(placeholder, secrets.token_hex(size))
if placeholders:
    mode = "iniciais" if os.environ.get("CREATED") == "1" else "novos da atualização"
    print(f"Segredos {mode} gerados: {len(placeholders)}")

path.write_text(result, encoding="utf-8")
print("env.example sincronizado com .env sem sobrescrever valores existentes.")
PYENV

chmod 600 "$ENV_FILE"

prepare_platform_data_dir() {
  local key="$1" value
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  value="$(printf '%s' "$value" | sed -e 's/^"//' -e 's/"$//')"
  [[ -n "$value" ]] || return 0
  [[ "$value" = /* ]] || value="$STACK_DIR/$value"
  mkdir -p "$value"
  # Dados runtime apenas. Segredos continuam fora destes diretórios e .env=0600.
  # UIDs internos variam entre API, Prometheus e Grafana; os binds precisam
  # permanecer graváveis pelos containers não-root existentes.
  chmod 0777 "$value"
}

for key in \
  ARGWS_CONNECT_PLATFORM_BACKUPS_DATA_PATH \
  ARGWS_CONNECT_PLATFORM_PROMETHEUS_DATA_PATH \
  ARGWS_CONNECT_PLATFORM_GRAFANA_DATA_PATH \
  ARGWS_CONNECT_PLATFORM_ACME_DATA_PATH \
  ARGWS_CONNECT_PLATFORM_CERTS_DATA_PATH \
  ARGWS_CONNECT_PLATFORM_CLOUDPANEL_STATE_PATH; do
  prepare_platform_data_dir "$key"
done

echo "Ambiente preparado: $ENV_FILE"
