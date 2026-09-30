#!/bin/sh
set -eu

should_run_migrations="false"

if [ "${ANALYTICS_SOURCE:-postgres-first}" != "youtube-only" ]; then
  if [ -n "${POSTGRES_HOST:-}" ] && [ -n "${POSTGRES_DB:-}" ] && [ -n "${POSTGRES_USER:-}" ]; then
    should_run_migrations="true"
  fi
fi

if [ "$should_run_migrations" = "true" ]; then
  # Wait for Postgres to be reachable before running migrations.
  # Handles the rare case where Docker DNS isn't ready at container start.
  MAX_RETRIES=30
  RETRY_INTERVAL=2
  attempt=1
  until node -e "
    const net = require('net');
    const s = net.createConnection(${POSTGRES_PORT:-5432}, '${POSTGRES_HOST}');
    s.on('connect', () => { s.destroy(); process.exit(0); });
    s.on('error', () => { s.destroy(); process.exit(1); });
  " 2>/dev/null; do
    if [ "$attempt" -ge "$MAX_RETRIES" ]; then
      echo "[startup] Postgres not reachable after ${MAX_RETRIES} attempts. Aborting."
      exit 1
    fi
    echo "[startup] Waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT:-5432} (attempt ${attempt}/${MAX_RETRIES})..."
    attempt=$((attempt + 1))
    sleep "$RETRY_INTERVAL"
  done
  echo "[startup] Postgres is reachable. Running database migrations..."
  node db/migrate.js
else
  echo "[startup] Skipping database migrations (Postgres not configured or ANALYTICS_SOURCE=youtube-only)."
fi

echo "[startup] Starting backend server..."
exec node index.js
