#!/bin/bash
set -euo pipefail

source ./Docker/scripts/env_functions.sh

if [ "${DOCKER_ENV:-false}" != "true" ]; then
    export_env_vars
fi

provider="${DATABASE_PROVIDER:-postgresql}"
case "$provider" in
    postgresql|mysql|psql_bouncer) ;;
    *)
        echo "Error: Database provider '$provider' is invalid."
        exit 1
        ;;
esac

max_attempts="${DATABASE_MIGRATION_MAX_ATTEMPTS:-30}"
retry_seconds="${DATABASE_MIGRATION_RETRY_SECONDS:-2}"
attempt=1

echo "Deploying ARGWS Connect database migrations for provider: $provider"
until npm run db:deploy; do
    if [ "$attempt" -ge "$max_attempts" ]; then
        echo "Migration failed after $attempt attempts."
        exit 1
    fi
    echo "Database not ready or migration failed (attempt $attempt/$max_attempts); retrying in ${retry_seconds}s..."
    attempt=$((attempt + 1))
    sleep "$retry_seconds"
done

echo "Migration succeeded. Generating Prisma client for provider: $provider"
npm run db:generate
echo "Prisma generate succeeded."
