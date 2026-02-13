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

- `FMP_API_KEY`
- `FINNHUB_API_KEY`
- `KITE_API_KEY`
- `KITE_API_SECRET`
- `KITE_ACCESS_TOKEN` (optional)
- `OPENTERMINALUI_PREFETCH_ENABLED` (optional)
- `OPENTERMINALUI_SQLITE_URL` (optional)
- `OPENTERMINALUI_CORS_ORIGINS` (optional, comma-separated)

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
