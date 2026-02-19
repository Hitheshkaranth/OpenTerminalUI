#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

REDIS=0
POSTGRES=0
DETACH=1
APP_PORT=8000

require_arg_value() {
  if [ -z "${2:-}" ]; then
    echo "Missing value for $1"
    exit 1
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --redis)
      REDIS=1
      shift
      ;;
    --postgres)
      POSTGRES=1
      shift
      ;;
    --no-detach)
      DETACH=0
      shift
      ;;
    --port)
      require_arg_value "$1" "${2:-}"
      APP_PORT="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: ./scripts/docker-up.sh [--redis] [--postgres] [--no-detach] [--port <host_port>]"
      exit 1
      ;;
  esac
done

case "$APP_PORT" in
  ''|*[!0-9]*)
    echo "Invalid port: $APP_PORT"
    exit 1
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Required command not found: docker"
  exit 1
fi

docker compose version >/dev/null
docker info >/dev/null
if docker compose up --help | grep -q -- "--wait"; then
  SUPPORTS_WAIT=1
else
  SUPPORTS_WAIT=0
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if [ "$REDIS" -eq 1 ] && ! grep -q "^REDIS_URL=" .env; then
  printf "\nREDIS_URL=redis://redis:6379/0\n" >> .env
fi

set -- compose
if [ "$REDIS" -eq 1 ]; then
  set -- "$@" --profile redis
fi
if [ "$POSTGRES" -eq 1 ]; then
  set -- "$@" --profile postgres
fi
set -- "$@" up --build
if [ "$DETACH" -eq 1 ]; then
  set -- "$@" -d
  if [ "$SUPPORTS_WAIT" -eq 1 ]; then
    set -- "$@" --wait
  fi
fi

echo "Running: docker $*"
APP_PORT="$APP_PORT" docker "$@"

echo
echo "Open http://127.0.0.1:$APP_PORT"
echo "API docs: http://127.0.0.1:$APP_PORT/docs"
