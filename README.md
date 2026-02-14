# OpenTerminalUI

OpenTerminalUI is a trading analytics workspace focused on NSE equities.  
It combines a FastAPI backend and a React terminal-style frontend to help you analyze stocks, screen opportunities, compare peers, and review valuation/fundamental data in one place.

## Project overview

- Stock search and chart data endpoints
- Screener, valuation, peers, and fundamentals APIs
- Portfolio/backtest and alert-oriented endpoints
- Web UI optimized for fast keyboard-and-panel workflows

## Repository structure

- `backend/` FastAPI app and business logic
- `frontend/` React + Vite + TypeScript app
- `config/` YAML runtime config
- `data/` symbol/reference datasets
- `trade_screens/` optional desktop helper scripts

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker Desktop (optional, for containerized run)

## Quick start (recommended: Docker)

1. Create runtime env file:

```bash
copy .env.example .env
```

2. Build and run:

```bash
docker compose up --build
```

3. Open:
- App: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/health`
- Healthz: `http://127.0.0.1:8000/healthz`

## Docker Compose modes

Run without Redis (default, in-memory + SQLite cache):

```bash
docker compose up --build
```

Run with Redis L2 cache (recommended):

```bash
set REDIS_URL=redis://redis:6379/0
docker compose --profile redis up --build
```

Auto rebuild/restart on every code change:

```bash
docker compose up --build
docker compose watch
```

With Redis profile:

```bash
set REDIS_URL=redis://redis:6379/0
docker compose --profile redis up --build
docker compose --profile redis watch
```

## Local development setup (without Docker)

1. Install backend dependencies:

```bash
pip install -r backend/requirements.txt
```

2. Create backend env file:

```bash
copy backend\.env.example backend\.env
```

3. Start backend:

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8010
```

4. In a second terminal, start frontend:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

5. Open:
- UI: `http://127.0.0.1:5173`
- API docs: `http://127.0.0.1:8010/docs`
- Health: `http://127.0.0.1:8010/health`

## Manual Docker run (alternative to compose)

```bash
copy .env.example .env
docker build -t openterminalui:latest .
docker run --rm -p 8000:8000 --name openterminalui --env-file .env openterminalui:latest
```

## Environment variables

- `backend/.env.example` is used for local backend runs
- `.env.example` is used for Docker/Compose runtime

Set real values for:

- `KITE_API_KEY`
- `KITE_API_SECRET`
- `KITE_ACCESS_TOKEN`

Recommended/optional:

- `FMP_API_KEY` (recommended)
- `FINNHUB_API_KEY` (recommended)
- `REDIS_URL` (optional; use `redis://redis:6379/0` when Compose `redis` profile is enabled)
- `OPENTERMINALUI_PREFETCH_ENABLED` (optional)
- `OPENTERMINALUI_SQLITE_URL` (optional)
- `OPENTERMINALUI_CORS_ORIGINS` (optional, comma-separated)

## Realtime architecture

### WS stream + fallback behavior

- Frontend primary realtime path: WebSocket to `/api/ws/quotes`
- Subscribe payload: `{ op: "subscribe", symbols: ["NSE:INFY", "NFO:RELIANCE24FEBFUT", ...] }`
- Backend broadcasts tick payloads: `ltp`, `change`, `change_pct`, `oi` (where available), `volume` (where available)
- If stream data is not available for a symbol, backend fallback polling path is used internally for supported markets.
- Frontend also keeps snapshot fallbacks (`/api/quotes`, `/api/stocks/{ticker}`) so UI can still render when WS is briefly unavailable.

### Enable Kite streaming

Set these env vars (local `backend/.env` or root `.env` for Docker):

- `KITE_API_KEY`
- `KITE_API_SECRET`
- `KITE_ACCESS_TOKEN`

Without valid Kite credentials:

- NSE/BSE quote APIs still work via fallback providers where possible
- NFO realtime streaming is limited because token subscription depends on Kite instruments and stream connectivity

## Futures chain flow

- `instruments_loader` background service refreshes Kite instruments (NFO FUT contracts) daily and stores them in SQLite (`future_contracts`).
- Futures endpoints:
  - `GET /api/futures/underlyings`
  - `GET /api/futures/chain/{underlying}`
- Chain response includes:
  - contract fields (expiry, tradingsymbol, instrument token, lot/tick size)
  - WS-compatible symbols (`ws_symbol`, `ws_symbols`, `token_to_ws_symbol`) for direct websocket subscription
  - quote fields (`ltp`, `change`, `change_pct`, `oi`, `volume`) when available

## News ingestion flow

- `news_ingestor` runs every 3 minutes.
- Provider priority:
  1. Finnhub (`FINNHUB_API_KEY`) market news
  2. FMP (`FMP_API_KEY`) general/stock news fallback
- Articles are normalized and deduplicated by URL into `news_articles`.
- News endpoints:
  - `GET /api/news/latest`
  - `GET /api/news/search`
  - `GET /api/news/by-ticker/{ticker}`
- News responses are cached with TTL policy `news_latest`.

## Troubleshooting

### WS not connecting

- Check backend is reachable at `http://127.0.0.1:8000` and WS path `/api/ws/quotes` is not blocked by proxy/CORS.
- Verify frontend `VITE_API_BASE_URL` points to the same backend host.
- Confirm `/metrics-lite`:
  - `ws_connected_clients` should increase after opening live views.

### Kite token errors / reconnect loops

- Ensure `KITE_ACCESS_TOKEN` is current (expired tokens cause reconnect loops/failures).
- Validate `KITE_API_KEY` and `KITE_API_SECRET` match the same app that issued the token.
- Check logs for events:
  - `event=kite_ws_error`
  - `event=kite_ws_closed`
  - `event=kite_manual_reconnect_*`
- Check `/metrics-lite` field `last_kite_stream_status`.

### API rate limits

- Finnhub/FMP may throttle or reject requests (HTTP 429/403).
- Set both keys where possible:
  - `FINNHUB_API_KEY`
  - `FMP_API_KEY`
- If news appears stale, inspect:
  - backend logs for `event=news_ingest_*`
  - `/metrics-lite` fields:
    - `last_news_ingest_at`
    - `last_news_ingest_status`

## Public commit safety checklist

Before pushing:

1. Keep real secrets only in local `backend/.env` and `.env` (both ignored).
2. Confirm no private env files are tracked:

```bash
git ls-files | findstr /R "\.env$ \.env\."
```

3. Confirm build/runtime artifacts are not tracked:

```bash
git ls-files | findstr /R "node_modules dist \.db$ \.sqlite$ \.sqlite3$"
```

4. Review staged changes:

```bash
git diff --cached
```

5. If any key was ever exposed, rotate it before release.
