# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────┐
│                     Browser                          │
│  React 18 + TypeScript + Zustand + TanStack Query   │
│  WebSocket client (realtime quotes/candles)          │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP / WebSocket
┌──────────────────────▼──────────────────────────────┐
│              FastAPI Application (Python 3.11)       │
│  Auth middleware → API Routes → Service Layer        │
│  Background services: news ingestor, instruments     │
│  WebSocket manager: /api/ws/quotes                   │
└────────┬──────────────────────┬─────────────────────┘
         │                      │
┌────────▼────────┐    ┌────────▼──────────────────────┐
│  Data Providers │    │  Database / Cache              │
│  ─────────────  │    │  ────────────────────────────  │
│  Kite (NSE/BSE) │    │  SQLite  — OHLCV cache, app DB │
│  Finnhub WS/REST│    │  PostgreSQL — optional prod DB  │
│  FMP (US hist.) │    │  Redis   — optional L2 cache    │
│  yfinance       │    └────────────────────────────────┘
│  NSEPython      │
└─────────────────┘
```

---

## Backend Layers

### 1. API Routes (`backend/api/routes/`)
Thin FastAPI route handlers. Each file owns one domain (stocks, options, backtests, risk, etc.). Routes call the service layer and return Pydantic-validated responses. No business logic lives here.

### 2. Service Layer (`backend/services/`)
Business logic and orchestration. Key services:

| Service | Responsibility |
|---|---|
| `marketdata_hub.py` | WebSocket tick/candle aggregation, quote stream fan-out |
| `kite_stream.py` | NSE/BSE real-time ticks via Zerodha Kite WebSocket |
| `finnhub_ws.py` | US real-time ticks via Finnhub WebSocket |
| `candle_aggregator.py` | Tick stream → interval OHLCV candle aggregation |
| `extended_hours_service.py` | Pre/post-market hour candle handling for US symbols |
| `instrument_map.py` | Symbol resolution: `RELIANCE` → `RELIANCE.NS`, etc. |
| `portfolio_analytics.py` | Correlation, dividend tracking, risk metrics |
| `backtest_jobs.py` | Async backtest job orchestration |
| `data_version_service.py` | Point-in-time data versioning for fundamentals |

### 3. Data Providers (`backend/providers/`)
Handles all external API calls. `chart_data.py` is the main entry point — it implements the waterfall fallback chain and normalises all responses to a unified OHLCV model.

### 4. Database / Cache (`backend/db/`)
- `ohlcv_cache.py` — SQLite-backed per-symbol cache with TTL
- `base.py`, `session.py` — SQLAlchemy async session setup
- `models.py` — ORM models for all persisted entities
- `migrations/` — Alembic migration chain (4 versions)

---

## Frontend Layers

```
pages/           ← One file per route (StockDetail, OptionChainPage, etc.)
  └─ components/ ← Reusable UI components
       ├─ terminal/     ← Design-system primitives (Button, Table, Modal…)
       ├─ common/       ← Domain-agnostic data components (EarningsCalendar…)
       ├─ chart/        ← Chart rendering and toolbar
       ├─ layout/       ← Page shells, panel chrome, navigation
       └─ [domain]/     ← Domain-specific components (backtesting, screener…)
store/           ← Zustand atoms (auth, realtime, UI state)
hooks/           ← Custom React hooks (useRealtimeQuote, useAuth, etc.)
api/             ← Axios API clients, typed wrappers per domain
realtime/        ← WebSocket manager, subscription registry
types/           ← Shared TypeScript type definitions
```

---

## Real-Time Data Flow

```
Zerodha Kite WS ──┐
                  ├──► MarketDataHub ──► CandleAggregator ──► WS Broadcast
Finnhub WS ───────┘         │                                     │
                             │                              React WS Client
                             ▼                                     │
                      Quote Store (Zustand) ◄─────────────────────┘
                             │
                      Chart Component (Lightweight Charts)
```

1. `kite_stream.py` and `finnhub_ws.py` connect to upstream WebSocket feeds and emit raw ticks.
2. `marketdata_hub.py` normalises ticks and distributes them to the `CandleAggregator`.
3. `candle_aggregator.py` builds OHLCV candles at each requested interval (1m, 5m, etc.).
4. Completed candles and tick updates are broadcast over `/api/ws/quotes` to all connected browser clients.
5. The React `realtime/` layer receives messages and updates the Zustand quote store.
6. The chart component subscribes to the Zustand store and calls `chart.update()` on each tick.

---

## Chart Data Waterfall

When a chart request arrives, `backend/providers/chart_data.py` follows this fallback chain:

**India:**
```
1. Zerodha Kite  →  historical OHLCV via REST (primary, best quality)
2. yfinance      →  Yahoo Finance scraping (fallback for historical depth)
3. NSEPython     →  NSE website scraping (tertiary, last resort)
```

**US:**
```
1. FMP           →  Financial Modeling Prep REST API (primary)
2. Finnhub       →  Finnhub REST (fallback)
3. yfinance      →  Yahoo Finance scraping (last resort)
```

All providers output a normalised `OHLCVBar` model before the response is cached and returned.

---

## Async Job Pattern

Long-running jobs (backtests, portfolio backtests) follow an async submit/poll/retrieve pattern:

```
POST /api/backtests          → returns { job_id }
GET  /api/backtests/{job_id} → returns { status: "pending" | "running" | "done" | "error" }
GET  /api/backtests/{job_id}/results → returns full result when status == "done"
```

The frontend polls at 2-second intervals until `status === "done"`, then fetches results once.

---

## Authentication Flow

```
POST /api/auth/login  →  { access_token (15 min), refresh_token (7 days) }
     ↓
All API requests:  Authorization: Bearer <access_token>
     ↓
Token expiry:  POST /api/auth/refresh  →  new access_token
     ↓
Middleware:  FastAPI auth middleware validates every request before routing
     ↓
Role checks:  "admin" vs "trader" vs "readonly" enforced at middleware level
```

Protected React routes use `<ProtectedRoute>` which checks the Zustand auth store and redirects to `/login` if unauthenticated.

---

## Key File Map

| Concern | File |
|---|---|
| FastAPI app entry | `backend/main.py` |
| Chart data provider | `backend/providers/chart_data.py` |
| Candle aggregation | `backend/services/candle_aggregator.py` |
| Market data WebSocket hub | `backend/services/marketdata_hub.py` |
| OHLCV cache | `backend/db/ohlcv_cache.py` |
| Screener engine | `backend/screener/engine.py` |
| Risk engine | `backend/risk_engine/` |
| OMS routes | `backend/api/routes/oms.py` |
| Auth middleware | `backend/auth/` |
| Frontend page index | `frontend/src/pages/` |
| Terminal design system | `frontend/src/components/terminal/` |
| Theme CSS tokens | `frontend/src/styles/terminal-theme.css` |
| Theme TypeScript utils | `frontend/src/theme/terminal.ts` |
| Global styles | `frontend/src/index.css` |
| Zustand stores | `frontend/src/store/` |
| WebSocket manager | `frontend/src/realtime/` |
| Backend tests | `backend/tests/` |
| E2E tests | `frontend/tests/e2e/` |
| CI workflow | `.github/workflows/ci.yml` |
| DB migrations | `backend/db/migrations/` |

---

## Database Schema Overview

The default store is **SQLite** (`openterminalui.db`) — suitable for development and single-user deployments. Switch to **PostgreSQL 16** for multi-user production.

Schema is managed via **Alembic** with 4 migrations:

| Version | Description |
|---|---|
| Initial | Core users, watchlists, alerts, paper trading schema |
| v0002 | Auth refresh token table |
| v0003 | Model Lab experiment and run registry |
| v0004 | Institutional data layer (corporate actions, fundamentals versioning) |

Run `alembic upgrade head` after switching databases.
