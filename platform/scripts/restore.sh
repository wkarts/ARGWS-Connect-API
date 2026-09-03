#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
ARCHIVE="${1:-}"
IDENTITY="${2:-}"
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "Uso: $0 /caminho/backup.tar.zst[.age] [/caminho/identity.txt]" >&2; exit 2; }
[[ -f .env ]] || { echo "ERRO: .env não encontrado." >&2; exit 1; }
ARCHIVE_ABS="$(realpath "$ARCHIVE")"
BACKUP_DIR="$(dirname "$ARCHIVE_ABS")"
BACKUP_FILE="$(basename "$ARCHIVE_ABS")"
IDENTITY_ARGS=()
IDENTITY_MOUNT=()
if [[ -n "$IDENTITY" ]]; then
  IDENTITY_ABS="$(realpath "$IDENTITY")"
  IDENTITY_MOUNT=(-v "$IDENTITY_ABS:/run/secrets/restore_age_identity:ro")
  IDENTITY_ARGS=(--identity /run/secrets/restore_age_identity)
fi
read -r -p "ATENÇÃO: a restauração substituirá Control Plane, tenants e objetos. Digite RESTAURAR: " CONFIRM
[[ "$CONFIRM" == "RESTAURAR" ]] || { echo "Cancelado."; exit 3; }
WORKERS=(connect-worker-default connect-worker-events connect-worker-notifications connect-worker-backups)
docker compose stop connect-api "${WORKERS[@]}" connect-beat connect-web connect-gateway || true
docker compose run --rm \
  -v "$BACKUP_DIR:/restore:ro" \
  "${IDENTITY_MOUNT[@]}" \
  connect-api python -m app.cli restore "/restore/$BACKUP_FILE" "${IDENTITY_ARGS[@]}" --yes
docker compose up -d connect-api "${WORKERS[@]}" connect-beat connect-web connect-gateway
echo "Restauração concluída. Execute: docker compose ps"
