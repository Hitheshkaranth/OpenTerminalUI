#!/usr/bin/env bash
set -euo pipefail

# Refuse to guess the environment: an unset OPENTERMINALUI_ENV means production in
# the app (fail closed), so make the operator say so explicitly here.
if [ -z "${OPENTERMINALUI_ENV:-}" ]; then
  echo "[entrypoint] OPENTERMINALUI_ENV is not set (use 'production', or 'development' for local single-user use)." >&2
  exit 1
fi

# Run migrations once per deployment. Extra replicas set RUN_MIGRATIONS=0.
# SKIP_MIGRATIONS=1 is still honoured for backward compatibility.
if [ "${RUN_MIGRATIONS:-1}" = "1" ] && [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  alembic -c backend/alembic.ini upgrade head
fi

# Seed an initial admin account on first launch so login works out of the box.
# Exits 0 when it seeds or skips (no credentials / a user already exists) and
# non-zero on a real error, which aborts startup.
python scripts/seed_admin.py

# --workers > 1 runs one copy of every background service per worker; scale with
# separate replicas (RUN_BACKGROUND_SERVICES=0 on API-only ones) instead.
exec python -m uvicorn backend.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --proxy-headers \
  --forwarded-allow-ips="${FORWARDED_ALLOW_IPS:-127.0.0.1}" \
  --timeout-graceful-shutdown 20 \
  --workers "${WEB_CONCURRENCY:-1}"
