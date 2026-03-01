# OpenTerminalUI

<p align="center">
  <img src="assets/logo.png" alt="OpenTerminalUI Logo" width="560" />
</p>

<p align="center">
  <strong>Analyze. Trade. Optimize.</strong><br />
  Open-source terminal-style trading and research workspace for India and US markets.
</p>

## Overview

OpenTerminalUI is a full-stack platform with:

- `backend/`: FastAPI services for market data, analytics, risk, alerts, and operations
- `frontend/`: React + TypeScript terminal UI with keyboard-first navigation
- `plugins/`: plugin extension points and examples
- `docker-compose.yml`: local service orchestration

## Product surfaces

### Terminal shell
- Unified shell with sidebar, status surfaces, GO bar, command palette (`Ctrl/Cmd+K`), and ticker tape
- Semantic theme token system and shared terminal primitives
- Launchpad and multi-route navigation across market modules

### Equity and market intelligence
- Stock detail and Security Hub workflows
- Chart Workstation and Launchpad charting flows
- Multi-market screener, watchlist, portfolio, and mutual-fund mode
- News, sentiment, and event-aware workflows
- Cockpit dashboard for cross-domain monitoring

### Derivatives (F&O)
- Option chain, Greeks, OI analysis, IV/heatmap, expiry, PCR, and strategy views
- Futures analytics with consistent shell behavior and routing

### Quant and backtesting
- Backtesting surfaces with Model Lab and Portfolio Lab
- Experiment tracking, run reports, compare pages, and governance workflows
- Portfolio lab blends and route-level run detail views

### Crypto and macro
- Dedicated crypto workspace (`/equity/crypto`) with charts, movers, heatmap/index, and alerts integration
- Economics and yield-curve dashboards
- Sector rotation and split comparison workflows

### Risk, operations, and extensibility
- Risk compute endpoints (VaR/CVaR/stress and related analytics)
- OMS/compliance and Ops dashboards
- Alerting channels and realtime WebSocket updates
- Provider adapters/registry with fallback behavior
- Plugin architecture for feature extension

## Repo layout

```text
backend/                 FastAPI app, services, providers, tests
frontend/                React app, shared UI primitives, unit/e2e tests
plugins/                 Example plugin packages
config/                  Runtime config
data/                    Fixtures and market reference data
docs/                    Architecture and implementation docs
scripts/                 Local helper scripts
.forge/                  Orchestration tasks/results/contracts
```

## Quick start (Docker)

Prerequisites:
- Docker Desktop
- Git

Run:

```bash
docker compose up -d --build
```

Default backend URL: `http://localhost:8000`

## Local development

### Backend

```bash
python -m venv .venv
# PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
python -m compileall backend
PYTHONPATH=. pytest backend/tests -q
uvicorn backend.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm ci
npm run build
npm run test
npm run dev
```

## CI gates

The CI workflow (`.github/workflows/ci.yml`) enforces:

1. Backend bytecode compile check
2. Backend pytest with coverage threshold (`--cov-fail-under=45`)
3. Frontend production build
4. Frontend unit tests (Vitest)
5. Playwright browser install + e2e smoke tests

## Public commit hygiene

- Keep local secrets out of git (`.env` should remain local)
- Keep generated artifacts and local caches ignored
- Ensure backend/frontend/e2e checks pass before push
- Keep `README` and About page in sync with shipped routes/features

## License

MIT. See [LICENSE](LICENSE).
