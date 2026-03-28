# OpenTerminalUI

<p align="center">
  <img src="assets/logo.png" alt="OpenTerminalUI logo" width="560" />
</p>

<p align="center">
  <strong>Open-source market terminal for discretionary traders, researchers, and quant workflows.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.1-0f172a" alt="Version 0.1.1" />
  <img src="https://img.shields.io/badge/python-3.11-3776AB?logo=python&logoColor=white" alt="Python 3.11" />
  <img src="https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white" alt="Node 22" />
  <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite 6" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

## Overview

OpenTerminalUI is a full-stack financial terminal with a terminal-style shell, research surfaces, chart workstations, derivatives tooling, portfolio analytics, and quant labs in one application.

The current app is organized around:

- Equity research and security analysis
- Multi-panel charting with replay, comparison, drawings, alerts, and workspace persistence
- F&O workflows including option chain, Greeks, PCR, OI, futures, expiry, and strategy views
- Portfolio, watchlist, paper trading, alerts, and operational dashboards
- Quant workflows for backtesting, model lab, portfolio lab, and governance
- Macro and cross-asset coverage for forex, commodities, bonds, ETFs, sector rotation, economics, crypto, and launchpad-style monitoring

The backend is a FastAPI app. The frontend is a React + Vite app. In production, the backend serves the built frontend bundle.

## Product Surface

### Core terminal shell

- Command bar and GO bar routing
- Persistent workspace framing and shell chrome
- Keyboard-first navigation across major routes
- Desktop and mobile-aware layouts

### Equity and research

- Home dashboard and market overview
- Security hub and stock detail workflows
- News, alerts, hotlists, watchlist, and screener workflows
- Portfolio, paper trading, and account/settings surfaces

### Advanced charting

- Multi-chart workstation with saved layouts
- Linked panes, synchronized crosshair/timeframe behavior, and replay controls
- Comparison overlays, drawing tools, export helpers, and context overlays
- Launchpad and split-comparison workflows

### Derivatives and cross-asset

- Option chain, Greeks, futures, OI analysis, PCR, strategy, expiry, and heatmap views
- Commodities, forex, bonds, ETF analytics, mutual funds, economics, yield curve, and crypto workspace routes

### Quant and ops

- Backtesting dashboard
- Model lab, run reports, compare flows, and governance
- Portfolio lab, blends, and run reports
- Risk, OMS/compliance, ops dashboard, cockpit, and plugin surfaces

## Main Routes

### Home and authentication

- `/`
- `/home`
- `/login`
- `/register`
- `/forgot-access`
- `/account`

### Equity workspace

- `/equity/dashboard`
- `/equity/stocks`
- `/equity/security`
- `/equity/security/:ticker`
- `/equity/commodities`
- `/equity/forex`
- `/equity/hotlists`
- `/equity/screener`
- `/equity/portfolio`
- `/equity/portfolio/lab`
- `/equity/watchlist`
- `/equity/news`
- `/equity/alerts`
- `/equity/paper`
- `/equity/risk`
- `/equity/oms`
- `/equity/ops`
- `/equity/chart-workstation`
- `/equity/launchpad`
- `/equity/launchpad/popout`
- `/equity/compare`
- `/equity/yield-curve`
- `/equity/economics`
- `/equity/sector-rotation`
- `/equity/crypto`
- `/equity/etf-analytics`
- `/equity/bonds`
- `/equity/mutual-funds`
- `/equity/plugins`
- `/equity/settings`
- `/equity/cockpit`
- `/equity/stocks/about`

### F&O workspace

- `/fno`
- `/fno/greeks`
- `/fno/futures`
- `/fno/oi`
- `/fno/strategy`
- `/fno/pcr`
- `/fno/heatmap`
- `/fno/expiry`
- `/fno/about`

### Backtesting and labs

- `/backtesting`
- `/backtesting/model-lab`
- `/backtesting/model-lab/experiments/:id`
- `/backtesting/model-lab/runs/:runId`
- `/backtesting/model-lab/compare`
- `/backtesting/model-governance`
- `/model-lab`
- `/portfolio-lab`

## Screenshots

<p align="center">
  <img src="assets/Enhanced_Home_Screen.png" alt="OpenTerminalUI home screen" width="900" />
</p>
<p align="center"><em>Home dashboard with shell chrome, market context, and workspace launch points.</em></p>

<p align="center">
  <img src="assets/Advanced_Workstation_6_Charts.png" alt="Chart workstation" width="900" />
</p>
<p align="center"><em>Multi-panel chart workstation with advanced charting workflows.</em></p>

<p align="center">
  <img src="assets/Advanced_Portfolio_Monitoring.png" alt="Portfolio monitoring" width="900" />
</p>
<p align="center"><em>Portfolio and monitoring surfaces for holdings, performance, and risk review.</em></p>

<p align="center">
  <img src="assets/Backtesting_Models_Simulations.png" alt="Backtesting and model lab" width="900" />
</p>
<p align="center"><em>Quant workflows for experiments, simulations, and reports.</em></p>

## Architecture

### Frontend

- React 18
- TypeScript
- Vite
- React Router
- TanStack Query
- Zustand
- Tailwind CSS
- lightweight-charts
- Playwright + Vitest

### Backend

- FastAPI
- Python 3.11
- SQLAlchemy
- Redis
- SQLite by default, Postgres optional
- Provider adapters for market data and research endpoints
- Pytest for backend validation

## Running Locally

### Prerequisites

- Python `3.11`
- Node `22`
- npm
- Docker and Docker Compose, if you want the containerized flow

### Option 1: Docker

This is the quickest full-stack path.

```bash
docker compose up --build
```

App:

- Backend + built frontend: `http://localhost:8000`

Optional services:

- Redis: `localhost:6379`
- Postgres profile: `docker compose --profile postgres up --build`

### Option 2: Local development

Backend:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
PYTHONPATH=. uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

App URLs in local dev:

- Backend API: `http://127.0.0.1:8000`
- Frontend dev server: `http://127.0.0.1:5173`

## Environment Notes

The repo can run without fully configured production credentials, but some provider-backed features degrade or return fallback/mock behavior when API keys are absent.

Common environment variables:

- `FMP_API_KEY`
- `FINNHUB_API_KEY`
- `KITE_API_KEY`
- `KITE_API_SECRET`
- `KITE_ACCESS_TOKEN`
- `JWT_SECRET_KEY`
- `CACHE_SIGNING_KEY`
- `DATABASE_URL`
- `REDIS_URL`
- `OPENTERMINALUI_CORS_ORIGINS`
- `OPENTERMINALUI_PREFETCH_ENABLED`

The backend also loads local environment settings through `backend.config.env`.

## Testing

### Backend

```bash
PYTHONPYCACHEPREFIX=/tmp/codex-pycache PYTHONPATH=. python -m compileall backend
PYTHONPYCACHEPREFIX=/tmp/codex-pycache PYTHONPATH=. pytest backend/tests -q
```

### Frontend

```bash
cd frontend
npm run build
NODE_OPTIONS=--max-old-space-size=4096 npx vitest run
```

### End-to-end

Install browsers if needed:

```bash
cd frontend
npx playwright install chromium
```

Run the smoke suite:

```bash
npm run test:e2e
```

## Current CI Gate

The repository CI currently checks the same broad path used for local verification:

- Python compile check
- Backend pytest suite
- Frontend production build
- Vitest suite
- Playwright smoke tests

## Repository Layout

```text
backend/                 FastAPI app, adapters, services, routes, tests
frontend/                React app, routes, components, Vitest tests, Playwright specs
plugins/                 Example plugin integrations
docs/                    Wiki, specs, plans, and contributor docs
data/                    Local app data and test sqlite files
docker-compose.yml       Local container stack
```

## Status

This repository is actively evolving. Routes, workflows, and product surfaces are broader than a simple stock dashboard and should be treated as a terminal platform rather than a single-purpose screener app.

## License

MIT
