#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-}"
shift || true

STACK_DIR="."
COMPOSE_FILE="compose.yaml"
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-dir) STACK_DIR="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --file) BACKUP_FILE="$2"; shift 2 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

STACK_DIR="$(cd "$STACK_DIR" && pwd)"
cd "$STACK_DIR"

ENV_FILE="${ENV_FILE:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERRO: $STACK_DIR/$ENV_FILE não encontrado." >&2
  exit 1
fi
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERRO: $STACK_DIR/$COMPOSE_FILE não encontrado." >&2
  exit 1
fi

env_get() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then value="${value:1:${#value}-2}"; fi
  if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}

resolve_path() {
  local value="$1"
  [[ -n "$value" ]] || return 1
  if [[ "$value" = /* ]]; then printf '%s' "$value"; else printf '%s/%s' "$STACK_DIR" "${value#./}"; fi
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

services="$(compose config --services)"
find_service() {
  local prefix="$1"
  printf '%s\n' "$services" | grep -E "^${prefix}($|-)" | head -n 1 || true
}

api_service="$(find_service api)"
postgres_service="$(find_service postgres)"
mysql_service="$(find_service mysql)"
redis_service="$(find_service redis)"
minio_service="$(find_service minio)"

API_KEY="$(env_get AUTHENTICATION_API_KEY)"
if [[ -z "$API_KEY" || "$API_KEY" == CHANGE_ME_* || ${#API_KEY} -lt 24 ]]; then
  echo "ERRO: AUTHENTICATION_API_KEY precisa estar definida com chave forte." >&2
  exit 1
fi

API_IMAGE="$(env_get ARGWS_CONNECT_API_IMAGE)"
API_IMAGE="${API_IMAGE:-ghcr.io/wkarts/argws-connect-api:latest}"

BACKUP_DIR_RAW="$(env_get ARGWS_CONNECT_BACKUPS_DATA_PATH)"
BACKUP_DIR_RAW="${BACKUP_DIR_RAW:-./volumes/backups}"
BACKUP_DIR="$(resolve_path "$BACKUP_DIR_RAW")"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

crypto_run() {
  local mode="$1" input="$2" output="${3:-}"
  local local_crypto
  local_crypto="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/connect-backup-crypto.cjs"

  # Prefer the local Connect|API crypto implementation when Node is available.
  # On minimal VPS hosts, use the application image that was already pulled.
  if command -v node >/dev/null 2>&1 && [[ -f "$local_crypto" ]]; then
    if [[ -n "$output" ]]; then
      AUTHENTICATION_API_KEY="$API_KEY" node "$local_crypto" "$mode" "$input" "$output"
    else
      AUTHENTICATION_API_KEY="$API_KEY" node "$local_crypto" "$mode" "$input"
    fi
    return
  fi

  local input_dir input_name output_dir output_name
  input_dir="$(cd "$(dirname "$input")" && pwd)"
  input_name="$(basename "$input")"
  if [[ -n "$output" ]]; then
    mkdir -p "$(dirname "$output")"
    output_dir="$(cd "$(dirname "$output")" && pwd)"
    output_name="$(basename "$output")"
    docker run --rm --entrypoint node \
      -e AUTHENTICATION_API_KEY="$API_KEY" \
      -v "$input_dir:/input:ro" \
      -v "$output_dir:/output" \
      "$API_IMAGE" \
      /argws-connect/scripts/connect-backup-crypto.cjs "$mode" "/input/$input_name" "/output/$output_name"
  else
    docker run --rm --entrypoint node \
      -e AUTHENTICATION_API_KEY="$API_KEY" \
      -v "$input_dir:/input:ro" \
      "$API_IMAGE" \
      /argws-connect/scripts/connect-backup-crypto.cjs "$mode" "/input/$input_name"
  fi
}

safe_empty_dir() {
  local dir="$1"
  mkdir -p "$dir"
  find "$dir" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
}

backup_create() {
  local timestamp tmp stage payload output app_version db_provider include_minio
  timestamp="$(date +%Y%m%d-%H%M%S)"
  tmp="$(mktemp -d "$BACKUP_DIR/.connect-backup-${timestamp}.XXXXXX")"
  stage="$tmp/payload"
  payload="$tmp/payload.tar"
  mkdir -p "$stage"

  app_version="unknown"
  if [[ -n "$api_service" ]] && [[ -n "$(compose ps -q "$api_service" 2>/dev/null || true)" ]]; then
    app_version="$(compose exec -T "$api_service" node -p "require('/argws-connect/package.json').version" 2>/dev/null | tr -d '\r' || true)"
    app_version="${app_version:-unknown}"
  fi

  local restart_api=0
  if [[ -n "$api_service" ]]; then
    local cid status
    cid="$(compose ps -q "$api_service" 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || true)"
      if [[ "$status" == "true" ]]; then
        echo "Pausando somente a API para snapshot consistente..." >&2
        compose stop "$api_service" >/dev/null
        restart_api=1
      fi
    fi
  fi

  cleanup_api() {
    if [[ "$restart_api" == "1" && -n "$api_service" ]]; then
      compose start "$api_service" >/dev/null 2>&1 || true
    fi
  }
  trap 'cleanup_api; rm -rf "$tmp"' EXIT

  db_provider="$(env_get DATABASE_PROVIDER)"
  db_provider="${db_provider:-postgresql}"

  if [[ "$db_provider" == "mysql" ]]; then
    if [[ -z "$mysql_service" ]]; then echo "ERRO: serviço MySQL não encontrado." >&2; exit 1; fi
    local mysql_db mysql_user mysql_pass
    mysql_db="$(env_get MYSQL_DATABASE)"; mysql_db="${mysql_db:-argws_connect_api}"
    mysql_user="$(env_get MYSQL_USERNAME)"; mysql_user="${mysql_user:-argws_connect}"
    mysql_pass="$(env_get MYSQL_PASSWORD)"
    echo "Salvando banco MySQL..." >&2
    compose exec -T "$mysql_service" sh -lc \
      "exec mysqldump --single-transaction --routines --triggers -u\"$mysql_user\" -p\"$mysql_pass\" \"$mysql_db\"" \
      > "$stage/database.sql"
  else
    if [[ -z "$postgres_service" ]]; then echo "ERRO: serviço PostgreSQL não encontrado." >&2; exit 1; fi
    local pg_db pg_user
    pg_db="$(env_get POSTGRES_DATABASE)"; pg_db="${pg_db:-argws_connect_api}"
    pg_user="$(env_get POSTGRES_USERNAME)"; pg_user="${pg_user:-argws_connect}"
    echo "Salvando banco PostgreSQL..." >&2
    compose exec -T "$postgres_service" pg_dump -U "$pg_user" -d "$pg_db" -Fc > "$stage/database.dump"
  fi

  local instances_raw instances_path redis_raw redis_path minio_raw minio_path
  instances_raw="$(env_get ARGWS_CONNECT_INSTANCES_DATA_PATH)"; instances_raw="${instances_raw:-./volumes/instances}"
  instances_path="$(resolve_path "$instances_raw")"
  if [[ -d "$instances_path" ]]; then
    echo "Salvando sessões/arquivos locais..." >&2
    tar -cf "$stage/instances.tar" -C "$instances_path" .
  fi

  redis_raw="$(env_get ARGWS_CONNECT_REDIS_DATA_PATH)"; redis_raw="${redis_raw:-./volumes/redis}"
  redis_path="$(resolve_path "$redis_raw")"
  if [[ -n "$redis_service" && -d "$redis_path" ]]; then
    local redis_pass
    redis_pass="$(env_get REDIS_PASSWORD)"
    if [[ -n "$redis_pass" ]]; then
      compose exec -T "$redis_service" redis-cli -a "$redis_pass" SAVE >/dev/null 2>&1 || true
    else
      compose exec -T "$redis_service" redis-cli SAVE >/dev/null 2>&1 || true
    fi
    echo "Salvando Redis..." >&2
    tar -cf "$stage/redis-data.tar" -C "$redis_path" .
  fi

  include_minio="$(env_get BACKUP_INCLUDE_MINIO)"
  include_minio="${include_minio:-true}"
  minio_raw="$(env_get ARGWS_CONNECT_MINIO_DATA_PATH)"; minio_raw="${minio_raw:-./volumes/minio}"
  minio_path="$(resolve_path "$minio_raw")"
  if [[ "$include_minio" == "true" && -d "$minio_path" ]]; then
    echo "Salvando objetos locais..." >&2
    tar -cf "$stage/minio-data.tar" -C "$minio_path" .
  fi

  cat > "$stage/manifest.json" <<EOF
{
  "format": 1,
  "product": "Connect|API",
  "createdAt": "$(date -Iseconds)",
  "appVersion": "$app_version",
  "databaseProvider": "$db_provider",
  "includes": {
    "database": true,
    "instances": $([[ -f "$stage/instances.tar" ]] && echo true || echo false),
    "redis": $([[ -f "$stage/redis-data.tar" ]] && echo true || echo false),
    "minio": $([[ -f "$stage/minio-data.tar" ]] && echo true || echo false)
  }
}
EOF

  (
    cd "$stage"
    find . -maxdepth 1 -type f ! -name manifest.sha256 -printf '%P\n' | sort | xargs -r sha256sum > manifest.sha256
  )

  tar -cf "$payload" -C "$stage" .
  output="$BACKUP_DIR/connect-api-${app_version}-${timestamp}.connectbak"
  echo "Criptografando backup..." >&2
  crypto_run encrypt "$payload" "$output"
  chmod 600 "$output" 2>/dev/null || true

  local retention
  retention="$(env_get BACKUP_RETENTION_COUNT)"
  retention="${retention:-10}"
  if [[ "$retention" =~ ^[0-9]+$ ]] && (( retention > 0 )); then
    mapfile -t old_backups < <(ls -1t "$BACKUP_DIR"/*.connectbak 2>/dev/null | tail -n "+$((retention + 1))" || true)
    if (( ${#old_backups[@]} > 0 )); then rm -f -- "${old_backups[@]}"; fi
  fi

  cleanup_api
  restart_api=0
  rm -rf "$tmp"
  trap - EXIT
  echo "$output"
}

backup_verify() {
  local file="$1" tmp payload_dir
  [[ -f "$file" ]] || { echo "ERRO: backup não encontrado: $file" >&2; exit 1; }
  tmp="$(mktemp -d "$BACKUP_DIR/.connect-verify.XXXXXX")"
  trap 'rm -rf "$tmp"' RETURN
  crypto_run decrypt "$file" "$tmp/payload.tar"
  mkdir -p "$tmp/payload"
  tar -xf "$tmp/payload.tar" -C "$tmp/payload"
  (
    cd "$tmp/payload"
    sha256sum -c manifest.sha256 >/dev/null
  )
  echo "OK: $(basename "$file")"
}

backup_restore() {
  local file="$1" tmp stage db_provider
  backup_verify "$file"
  tmp="$(mktemp -d "$BACKUP_DIR/.connect-restore.XXXXXX")"
  trap 'rm -rf "$tmp"' RETURN
  crypto_run decrypt "$file" "$tmp/payload.tar"
  stage="$tmp/payload"
  mkdir -p "$stage"
  tar -xf "$tmp/payload.tar" -C "$stage"

  db_provider="$(grep -E '"databaseProvider"' "$stage/manifest.json" | head -1 | cut -d'"' -f4)"
  db_provider="${db_provider:-postgresql}"

  if [[ -n "$api_service" ]]; then compose stop "$api_service" >/dev/null 2>&1 || true; fi

  if [[ "$db_provider" == "mysql" && -f "$stage/database.sql" ]]; then
    local mysql_db mysql_user mysql_pass
    mysql_db="$(env_get MYSQL_DATABASE)"; mysql_db="${mysql_db:-argws_connect_api}"
    mysql_user="$(env_get MYSQL_USERNAME)"; mysql_user="${mysql_user:-argws_connect}"
    mysql_pass="$(env_get MYSQL_PASSWORD)"
    compose exec -T "$mysql_service" sh -lc \
      "exec mysql -u\"$mysql_user\" -p\"$mysql_pass\" \"$mysql_db\"" < "$stage/database.sql"
  elif [[ -f "$stage/database.dump" ]]; then
    local pg_db pg_user
    pg_db="$(env_get POSTGRES_DATABASE)"; pg_db="${pg_db:-argws_connect_api}"
    pg_user="$(env_get POSTGRES_USERNAME)"; pg_user="${pg_user:-argws_connect}"
    compose exec -T "$postgres_service" pg_restore \
      -U "$pg_user" -d "$pg_db" --clean --if-exists --no-owner --no-privileges < "$stage/database.dump"
  fi

  local instances_raw instances_path redis_raw redis_path minio_raw minio_path
  instances_raw="$(env_get ARGWS_CONNECT_INSTANCES_DATA_PATH)"; instances_raw="${instances_raw:-./volumes/instances}"
  instances_path="$(resolve_path "$instances_raw")"
  if [[ -f "$stage/instances.tar" ]]; then
    safe_empty_dir "$instances_path"
    tar -xf "$stage/instances.tar" -C "$instances_path"
  fi

  redis_raw="$(env_get ARGWS_CONNECT_REDIS_DATA_PATH)"; redis_raw="${redis_raw:-./volumes/redis}"
  redis_path="$(resolve_path "$redis_raw")"
  if [[ -f "$stage/redis-data.tar" && -n "$redis_service" ]]; then
    compose stop "$redis_service" >/dev/null 2>&1 || true
    safe_empty_dir "$redis_path"
    tar -xf "$stage/redis-data.tar" -C "$redis_path"
    compose start "$redis_service" >/dev/null
  fi

  minio_raw="$(env_get ARGWS_CONNECT_MINIO_DATA_PATH)"; minio_raw="${minio_raw:-./volumes/minio}"
  minio_path="$(resolve_path "$minio_raw")"
  if [[ -f "$stage/minio-data.tar" && -n "$minio_service" ]]; then
    compose stop "$minio_service" >/dev/null 2>&1 || true
    safe_empty_dir "$minio_path"
    tar -xf "$stage/minio-data.tar" -C "$minio_path"
    compose start "$minio_service" >/dev/null
  fi

  compose up -d
  echo "Restore concluído: $(basename "$file")"
}

case "$COMMAND" in
  backup)
    backup_create
    ;;
  verify)
    [[ -n "$BACKUP_FILE" ]] || { echo "Use --file <arquivo.connectbak>" >&2; exit 2; }
    BACKUP_FILE="$(cd "$(dirname "$BACKUP_FILE")" && pwd)/$(basename "$BACKUP_FILE")"
    backup_verify "$BACKUP_FILE"
    ;;
  restore)
    [[ -n "$BACKUP_FILE" ]] || { echo "Use --file <arquivo.connectbak>" >&2; exit 2; }
    BACKUP_FILE="$(cd "$(dirname "$BACKUP_FILE")" && pwd)/$(basename "$BACKUP_FILE")"
    backup_restore "$BACKUP_FILE"
    ;;
  *)
    echo "Uso: connect-stack-backup.sh <backup|verify|restore> --stack-dir DIR --compose-file FILE [--file BACKUP]" >&2
    exit 2
    ;;
esac
