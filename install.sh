#!/usr/bin/env bash
# ============================================================================
# OpenTerminalUI — one-command installer.
#
#   ./install.sh                # auto-detect: Docker if available, else local
#   OTUI_MODE=docker ./install.sh
#   OTUI_MODE=local  ./install.sh
#
# What it does so you are never blocked on first launch:
#   * Creates a single .env from .env.example (if missing).
#   * Auto-generates strong JWT_SECRET_KEY + CACHE_SIGNING_KEY (no secret errors).
#   * Auto-generates a unique admin password and seeds an admin account
#     (no "user not found" / login errors).
#   * Builds and starts the app at http://localhost:8000.
#   * Prints the admin credentials at the end.
# ============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"
PORT="${APP_PORT:-8000}"

cyan() { printf "\033[36m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }

# --- Host OS detection so the installer can adapt -------------------------
# Sets: OTUI_OS  (macos|linux|wsl|windows)
#       PY_BIN   (python3 or python)
detect_os() {
  local uname_s
  uname_s="$(uname -s 2>/dev/null || echo unknown)"
  case "$uname_s" in
    Darwin) OTUI_OS="macos" ;;
    Linux)
      if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
        OTUI_OS="wsl"
      else
        OTUI_OS="linux"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*) OTUI_OS="windows" ;;
    *) OTUI_OS="unknown" ;;
  esac

  if command -v python3 >/dev/null 2>&1; then
    PY_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PY_BIN="python"
  else
    PY_BIN=""
  fi
}

# Open the app in the default browser, adapting to the host OS.
open_browser() {
  local url="$1"
  case "$OTUI_OS" in
    macos) command -v open >/dev/null 2>&1 && open "$url" >/dev/null 2>&1 || true ;;
    linux) command -v xdg-open >/dev/null 2>&1 && xdg-open "$url" >/dev/null 2>&1 || true ;;
    wsl|windows)
      if command -v powershell.exe >/dev/null 2>&1; then
        powershell.exe -NoProfile Start-Process "$url" >/dev/null 2>&1 || true
      elif command -v cmd.exe >/dev/null 2>&1; then
        cmd.exe /c start "" "$url" >/dev/null 2>&1 || true
      fi
      ;;
  esac
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [ -n "${PY_BIN:-}" ]; then
    "$PY_BIN" -c "import secrets; print(secrets.token_hex(32))"
  else
    # Last-resort fallback using the kernel RNG.
    head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Read a KEY's value from .env (empty string if unset/blank).
env_get() {
  local key="$1"
  [ -f "$ENV_FILE" ] || { echo ""; return; }
  sed -n "s/^${key}=//p" "$ENV_FILE" | head -n1
}

# Set KEY=VALUE in .env (replace existing line or append). Value is written literally.
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if [ -f "$ENV_FILE" ] && grep -q "^${key}=" "$ENV_FILE"; then
    # Use a non-/ delimiter so secrets with slashes are safe.
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    rm -f "$tmp"
    printf "%s=%s\n" "$key" "$value" >> "$ENV_FILE"
  fi
}

# Fill KEY with a value only if it is currently blank.
ensure_var() {
  local key="$1" value="$2"
  local current
  current="$(env_get "$key")"
  if [ -z "$current" ]; then
    env_set "$key" "$value"
  fi
}

cyan "==> OpenTerminalUI installer"

# --- 0. Detect host OS and adapt ------------------------------------------
detect_os
green "    detected OS: ${OTUI_OS}  (python: ${PY_BIN:-not found})"
if [ "$OTUI_OS" = "windows" ]; then
  yellow "    Native Windows detected. For the smoothest experience run the"
  yellow "    PowerShell installer instead:   ./install.ps1"
fi

# --- 1. Ensure single .env exists -----------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  green "    created .env from .env.example"
else
  yellow "    .env already exists — keeping your values, filling blanks only"
fi

# --- 2. Auto-fill secrets + admin so there are no login/secret errors -----
ensure_var JWT_SECRET_KEY "$(gen_secret)"
ensure_var CACHE_SIGNING_KEY "$(gen_secret)"
ensure_var BOOTSTRAP_ADMIN_EMAIL "admin@openterminal.local"

ADMIN_PASS="$(env_get BOOTSTRAP_ADMIN_PASSWORD)"
if [ -z "$ADMIN_PASS" ]; then
  ADMIN_PASS="$(gen_secret | cut -c1-20)"
  env_set BOOTSTRAP_ADMIN_PASSWORD "$ADMIN_PASS"
fi
ADMIN_EMAIL="$(env_get BOOTSTRAP_ADMIN_EMAIL)"
green "    secrets + admin account configured"

# --- 3. Pick a run mode ----------------------------------------------------
MODE="${OTUI_MODE:-auto}"
if [ "$MODE" = "auto" ]; then
  # Require a *running* daemon — `docker compose version` succeeds even when the
  # Docker daemon is stopped, so check `docker info` as well.
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    MODE="docker"
  else
    if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
      yellow "    Docker is installed but its daemon isn't running — falling back to local mode."
      yellow "    (start Docker Desktop and re-run, or force it with: OTUI_MODE=docker ./install.sh)"
    fi
    MODE="local"
  fi
fi
cyan "==> install mode: $MODE"

run_docker() {
  green "    building & starting containers (docker compose)..."
  docker compose --env-file "$ENV_FILE" up -d --build
  # The container entrypoint runs migrations + admin seeding automatically.
}

run_local() {
  [ -n "${PY_BIN:-}" ] || { yellow "Python not found; install Python 3.11+"; exit 1; }
  command -v npm >/dev/null 2>&1 || { yellow "npm not found; install Node 20+"; exit 1; }

  # On Windows/Git-Bash the venv layout is Scripts/ not bin/.
  local venv_py
  green "    setting up Python backend..."
  [ -d "$ROOT_DIR/.venv" ] || "$PY_BIN" -m venv "$ROOT_DIR/.venv"
  if [ -x "$ROOT_DIR/.venv/bin/python" ]; then
    venv_py="$ROOT_DIR/.venv/bin/python"
  else
    venv_py="$ROOT_DIR/.venv/Scripts/python.exe"
  fi
  "$venv_py" -m pip install --quiet --upgrade pip
  "$venv_py" -m pip install --quiet -r "$ROOT_DIR/backend/requirements.txt"

  green "    building frontend..."
  (cd "$ROOT_DIR/frontend" && npm ci && npm run build)

  green "    running database migrations..."
  PYTHONPATH="$ROOT_DIR" "$venv_py" -m alembic -c "$ROOT_DIR/backend/alembic.ini" upgrade head || true

  green "    seeding admin account..."
  PYTHONPATH="$ROOT_DIR" "$venv_py" "$ROOT_DIR/scripts/seed_admin.py"

  open_browser "http://localhost:${PORT}"
  green "    starting server at http://localhost:${PORT} (Ctrl+C to stop)..."
  exec env PYTHONPATH="$ROOT_DIR" "$venv_py" -m uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
}

print_credentials() {
  echo
  green "============================================================"
  green " OpenTerminalUI is ready  ->  http://localhost:${PORT}"
  green "------------------------------------------------------------"
  green "  Log in with:"
  green "    email:    ${ADMIN_EMAIL}"
  green "    password: ${ADMIN_PASS}"
  green "  (also saved in your .env — change it after first login)"
  green "============================================================"
  echo
  cyan "  Add API keys any time with:  make keys"
}

if [ "$MODE" = "docker" ]; then
  run_docker
  open_browser "http://localhost:${PORT}"
  print_credentials
else
  # Local mode runs the server in the foreground, so print creds first.
  print_credentials
  run_local
fi
