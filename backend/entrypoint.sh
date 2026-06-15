#!/usr/bin/env sh
set -e

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  alembic -c backend/alembic.ini upgrade head
fi

# Seed an initial admin account on first launch so login works out of the box.
# Idempotent: skips automatically once any user exists or if no password is set.
python scripts/seed_admin.py || true

exec python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
