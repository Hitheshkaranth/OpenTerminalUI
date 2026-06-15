#!/usr/bin/env bash
# ============================================================================
# OpenTerminalUI — interactive API-key wizard.
#
#   ./scripts/setup-keys.sh      (or:  make keys)
#
# Walks through every supported API key, shows what each one unlocks, and
# writes them all into the single repo-root .env. Press Enter to keep the
# current value / skip. All keys are optional — the app runs without them.
# ============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

cyan() { printf "\033[36m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
dim() { printf "\033[2m%s\033[0m\n" "$1"; }

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  green "Created .env from .env.example"
fi

env_get() { sed -n "s/^${1}=//p" "$ENV_FILE" | head -n1; }

env_set() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf "%s=%s\n" "$key" "$value" >> "$ENV_FILE"
  fi
}

# prompt KEY "Description"
prompt() {
  local key="$1" desc="$2" current shown reply
  current="$(env_get "$key")"
  cyan "• ${key}"
  dim "  ${desc}"
  if [ -n "$current" ]; then
    shown="${current:0:4}…(set)"
    printf "  current: %s\n  new value [Enter to keep]: " "$shown"
  else
    printf "  new value [Enter to skip]: "
  fi
  read -r reply || reply=""
  if [ -n "$reply" ]; then
    env_set "$key" "$reply"
    green "  saved."
  fi
  echo
}

cyan "==> OpenTerminalUI API key setup  (writing to .env)"
echo
dim "All keys are OPTIONAL. The app runs with built-in fallback data without them."
echo

prompt FMP_API_KEY      "Financial Modeling Prep — US equities, fundamentals, earnings"
prompt FINNHUB_API_KEY  "Finnhub — US real-time WebSocket ticks"
prompt FRED_API_KEY     "FRED — macro / economic data series"
prompt ALPACA_API_KEY   "Alpaca — US market data (key)"
prompt ALPACA_SECRET_KEY "Alpaca — US market data (secret)"
prompt KITE_API_KEY     "Zerodha Kite — India NSE/BSE real-time + historical (key)"
prompt KITE_API_SECRET  "Zerodha Kite — (secret)"
prompt KITE_ACCESS_TOKEN "Zerodha Kite — optional daily access token"
prompt OPENAI_API_KEY   "OpenAI — AI news sentiment & emotion analysis"

green "Done. Keys saved to .env"
dim "Restart the app to pick up changes:  docker compose up -d   (or re-run ./install.sh)"
