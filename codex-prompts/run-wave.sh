#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -eq 0 ]; then
    echo "Usage: $0 <wave_number|all|check> [--model MODEL] [--max-parallel N] [--dry-run]"
    exit 0
fi

exec python3 "$PROJECT_DIR/scripts/forge.py" run "$@"
