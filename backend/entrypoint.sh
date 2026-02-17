#!/usr/bin/env sh
set -e

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  alembic -c backend/alembic.ini upgrade head
fi

exec python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
