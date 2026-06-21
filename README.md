# OpenTerminalUI

<p align="center">
  <img src="assets/logo.png" alt="OpenTerminalUI logo" width="560" />
</p>

<p align="center">
  <strong>The open-source financial terminal for traders, researchers, and quant teams.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.5.0-0f172a" alt="Version 0.5.0" />
  <img src="https://img.shields.io/badge/python-3.11-3776AB?logo=python&logoColor=white" alt="Python 3.11" />
  <img src="https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white" alt="Node 22" />
  <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite 6" />
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

<p align="center">
  <a href="https://hitheshkaranth.github.io/OpenTerminalUI/">Website</a> |
  <a href="#features">Features</a> |
  <a href="#screenshots">Screenshots</a> |
  <a href="#architecture">Architecture</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

OpenTerminalUI is a self-hosted, full-stack financial terminal that combines real-time market data, institutional-grade charting, derivatives analytics, portfolio management, and quant research into a single platform. Built with a terminal-style shell interface inspired by Bloomberg and Refinitiv, it delivers professional-grade workflows to anyone with a browser.

**Multi-market coverage** across NSE, BSE, NYSE, NASDAQ, crypto, commodities, forex, bonds, ETFs, and mutual funds. **70+ technical indicators**, **multi-panel chart workstations**, **F&O option chains with live Greeks**, **backtesting with Model Lab**, **statistical arbitrage with Pair Trading Lab**, **portfolio analytics with risk engine**, a **tool-using AI research agent with multi-agent debate**, and an **extensible plugin system** &mdash; all running on your own hardware.

## Screenshots

### Workspace & Markets

<p align="center">
  <img src="assets/screenshots/home.png" alt="Home Dashboard" width="900" />
</p>
<p align="center"><em>Home / Mission Control — market context, AI Market Outlook, portfolio hub, system health, and the full feature launch grid.</em></p>

<p align="center">
  <img src="assets/screenshots/chart-workstation.png" alt="Chart Workstation" width="900" />
</p>
<p align="center"><em>Multi-panel chart workstation — a 6-chart grid with synchronized crosshairs, 70+ technical indicators, and drawing tools.</em></p>

<p align="center">
  <img src="assets/screenshots/market-view.png" alt="Market View" width="900" />
</p>
<p align="center"><em>Full-screen market view (AAPL, NASDAQ) — candlestick price action with volume, multi-timeframe, and indicator overlays.</em></p>

<p align="center">
  <img src="assets/screenshots/stock-detail.png" alt="Security Hub (US)" width="900" />
</p>
<p align="center"><em>Security Hub for a US name (AAPL) — quotes, fundamentals, price chart, analysis tabs, and the AI Catalyst &amp; Conviction panel.</em></p>

<p align="center">
  <img src="assets/screenshots/security-hub-india.png" alt="Security Hub (India)" width="900" />
</p>
<p align="center"><em>Security Hub for an Indian name (RELIANCE, NSE) — the same workflow across markets, with India fundamentals and sector context.</em></p>

<p align="center">
  <img src="assets/screenshots/financial-analysis.png" alt="Financial Analysis" width="900" />
</p>
<p align="center"><em>Financial analysis — income statement, balance sheet, and cash-flow statements with multi-period trends.</em></p>

<p align="center">
  <img src="assets/screenshots/fno-option-chain.png" alt="F&O Option Chain" width="900" />
</p>
<p align="center"><em>Futures &amp; Options — live option chain with Greeks, OI build-up, and PCR signals.</em></p>

<p align="center">
  <img src="assets/screenshots/commodities.png" alt="Commodities" width="900" />
</p>
<p align="center"><em>Cross-asset coverage — commodities, forex, crypto, bonds, ETFs, and mutual funds.</em></p>

### Research & Stock Picking

<p align="center">
  <img src="assets/screenshots/screener.png" alt="Advanced Screener" width="900" />
</p>
<p align="center"><em>Advanced screener with query builder, custom formula engine, composite factor scores, and "why ranked" insights.</em></p>

<p align="center">
  <img src="assets/screenshots/factor-dashboard.png" alt="Factor Dashboard" width="900" />
</p>
<p align="center"><em>Factor Dashboard — multi-factor (Value / Momentum / Quality / Low-Vol) idea lists and ranked picks for US &amp; Indian markets.</em></p>

<p align="center">
  <img src="assets/screenshots/news-sentiment.png" alt="News & Sentiment" width="900" />
</p>
<p align="center"><em>News &amp; Sentiment with the AI Emotion Indicator powered by a local Gemma model via LM Studio.</em></p>

<p align="center">
  <img src="assets/screenshots/intelligence-timeline.png" alt="Intelligence Timeline" width="900" />
</p>
<p align="center"><em>Unified Intelligence Timeline — news, alerts, events, insider activity, earnings, and model signals in one feed.</em></p>

### Portfolio, Risk & Backtesting

<p align="center">
  <img src="assets/screenshots/portfolio.png" alt="Portfolio" width="900" />
</p>
<p align="center"><em>Portfolio monitoring — holdings, movement &amp; historical return, risk metrics, and AI Risk Assessment.</em></p>

<p align="center">
  <img src="assets/screenshots/cockpit.png" alt="Cockpit" width="900" />
</p>
<p align="center"><em>Cockpit Priority Stack — a ranked daily brief across portfolio risk, alerts, catalysts, movers, and model signals.</em></p>

<p align="center">
  <img src="assets/screenshots/risk-dashboard.png" alt="Risk Dashboard" width="900" />
</p>
<p align="center"><em>Risk dashboard with statistical risk metrics, factor/exposure heatmaps, and AI Risk Insights powered by Gemma.</em></p>

<p align="center">
  <img src="assets/screenshots/backtesting.png" alt="Backtesting Lab" width="900" />
</p>
<p align="center"><em>Backtesting workspace with strategy presets, execution-profile modeling, performance summary, and AI analysis.</em></p>

<p align="center">
  <img src="assets/screenshots/model-lab.png" alt="Model Lab" width="900" />
</p>
<p align="center"><em>Model Lab — parameter sweeps, walk-forward validation, Monte Carlo robustness, and run leaderboards.</em></p>

<p align="center">
  <img src="assets/screenshots/portfolio-lab.png" alt="Portfolio Lab" width="900" />
</p>
<p align="center"><em>Portfolio Lab — multi-asset portfolio backtests, strategy blends, and correlation analysis.</em></p>

<p align="center">
  <img src="assets/screenshots/watchlist.png" alt="Watchlist" width="900" />
</p>
<p align="center"><em>Watchlists with live quotes, heatmap view, and one-click routing to charts, screener, and backtests.</em></p>

### AI Research Agent

<p align="center">
  <img src="assets/screenshots/ai-agent.png" alt="AI Research Agent" width="420" />
</p>
<p align="center"><em>The tool-using research agent (<code>Ctrl/Cmd&nbsp;+&nbsp;J</code>) — a screen-aware verdict on AAPL backed by a live snapshot card it fetched itself.</em></p>

<p align="center">
  <img src="assets/screenshots/strategy-lab.png" alt="Strategy Lab agent" width="420" />
</p>
<p align="center"><em>Strategy Lab — the agent proposes a strategy, backtests it, changes one variable to iterate, then runs out-of-sample validation and reports an honest verdict (here, "not a validated edge" at p&nbsp;=&nbsp;0.25).</em></p>

## Features

### Terminal Shell

- **GO Bar** (`Ctrl+G`) &mdash; Bloomberg-style command bar with symbol lookup and route navigation
- **Command Palette** (`Ctrl+K`) &mdash; fuzzy search across 25+ functions, tickers, and natural language queries
- **Function Keys** (`F1`-`F9`) &mdash; rapid workspace switching with Bloomberg-style hotkeys
- **Ticker Tape** &mdash; rolling market pulse with live quotes across exchanges
- **Theme Engine** &mdash; Terminal Noir (default), classic, and light themes with custom accent support
- **Desktop & Mobile Layouts** &mdash; responsive design with persistent workspace framing

### Charting & Technical Analysis

- **Multi-Panel Workstation** &mdash; up to 9 synchronized chart panels with crosshair linking
- **70+ Technical Indicators** &mdash; SMA, EMA, RSI, MACD, Bollinger Bands, Keltner, Supertrend, ATR, VWAP, OBV, CMF, Stochastic, CCI, ADX, Donchian, and many more
- **Multi-Timeframe** &mdash; 1m, 2m, 5m, 15m, 30m, 1h, 4h, 1D, 1W, 1M with extended hours toggle
- **Drawing Tools** &mdash; persistent annotations with templates, save/restore
- **Volume Profile** &mdash; VPOC + 70% value area overlay
- **Replay Mode** &mdash; step through historical price action bar by bar
- **Comparison Overlays** &mdash; multi-symbol normalized or raw price comparison
- **Alternative Charts** &mdash; Renko, Kagi, Point & Figure, Line Break
- **Chart Export** &mdash; PNG, SVG, and CSV data export
- **OpenScript** &mdash; custom indicator scripting with script library

### Equity Research & Security Hub

- **8-Tab Security Analysis** &mdash; overview, financials, chart, news/sentiment, ownership, estimates, peers, ESG
- **Fundamental Metrics** &mdash; P/E, P/B, ROE, ROA, dividend yield, earnings growth, debt ratios
- **Earnings Calendar** &mdash; historical surprises, upcoming events, guidance tracking
- **Shareholding History** &mdash; promoter/FII/DII/public breakdown with trend visualization
- **Analyst Estimates** &mdash; consensus tracking, revisions, and target prices
- **Corporate Actions** &mdash; splits, dividends, rights, bonuses timeline
- **Peer Comparison** &mdash; relative valuation matrices across comparable companies
- **Insider Trading Monitor** &mdash; recent insider trades, per-stock insider activity, top buyers/sellers leaderboard, and cluster-buy detection with minimum insider thresholds
- **Trade Journal** &mdash; trade logging with equity curve, calendar heatmap, and performance statistics

### Advanced Screener

- **Query Builder** &mdash; custom filters with preset formulas and arithmetic operations
- **Custom Formula Engine** &mdash; write, save, and share custom formulas with server-side evaluation, formula library with descriptions and categories
- **15+ Visualization Modes** &mdash; tables with sparklines, sector treemaps, heatmaps, scatter plots, radar charts, box plots, bubble charts, waterfall charts, RRG quadrants, gauge dials, distribution histograms, stacked area, and comparison bars
- **Multi-Market Scanning** &mdash; NSE, BSE, NYSE, NASDAQ with technical and fundamental overlays
- **Preset Management** &mdash; save, load, share, and browse community screens
- **Score-Based Ranking** &mdash; deterministic scoring with stable ordering and explainable setup detection

### Insight-Driven Stock Picking

- **Multi-Factor Composite Scoring** &mdash; cross-sectional, sector-relative Value / Momentum / Quality / Low-Volatility z-scores combined into a weighted composite rank
- **Ranked Idea Lists** &mdash; top-quintile picks per market and sector for both US (NYSE/NASDAQ) and Indian (NSE/BSE) universes
- **Factor Dashboard** &mdash; per-symbol factor radar, factor chips, and conviction scoring with a US/India market toggle
- **Catalyst & Conviction Engine** &mdash; LLM-extracted sentiment and upcoming catalysts from NSE/BSE and SEC filings, surfaced in the Security Hub
- **Point-in-Time Fundamentals** &mdash; as-reported fundamental history that removes look-ahead bias from factor and fundamental backtests
- **Why-Ranked Explanations** &mdash; composite scores, factor chips, and plain-language rationale on screener rows, with one-click routing to chart and backtest

### AI Research Agent

- **Conversational Console** &mdash; a slide-over agent panel (toggle with **Ctrl/Cmd + J**) that researches and analyzes stocks on demand
- **Tool-Using Agentic Loop** &mdash; the agent autonomously calls read-only tools &mdash; screener, full stock snapshot, multi-ticker compare, and research-knowledge-base search (RAG) &mdash; and reasons over the results
- **Screen-Aware Context** &mdash; defaults to the stock you currently have open and your selected market, so "tell me about this stock" resolves to the right ticker/exchange without re-typing it
- **Multi-Agent Debate Mode** &mdash; an analyst team (fundamental / sentiment / technical) feeds a bull-vs-bear debate that a portfolio manager resolves into a `BUY / HOLD / SELL` decision with a conviction score
- **Strategy Lab (idea &rarr; tested result loop)** &mdash; a bounded, read-only research loop that proposes a strategy, backtests it, changes one variable to iterate toward a target metric, then runs **mandatory out-of-sample validation** (permutation + multi-window robustness) and reports an honest verdict &mdash; refusing to call a curve-fit result an edge. Flag-gated and capped on rounds and wall-clock
- **Beautifully Rendered Output** &mdash; answers render as styled markdown (headings, tables, lists), stock snapshots as crafted cards (logo, price, valuation/quality/growth metrics), and debates as a phase stepper with bull/bear cards and a decision banner with conviction meter
- **Provider-Flexible** &mdash; runs against OpenRouter, OpenAI, or a local **LM Studio** model, with an automatic free-model fallback chain
- **Read-Only & Resilient** &mdash; the agent never places orders or mutates data, and degrades gracefully on rate limits, empty completions, or unavailable data sources

### Futures & Options (F&O)

- **Option Chain** &mdash; full contract listing with live Greeks (Delta, Gamma, Theta, Vega, Rho)
- **IV Analysis** &mdash; historical and implied volatility tracking, term structure visualization
- **Strategy Builder** &mdash; multi-leg construction for spreads, butterflies, straddles, strangles
- **OI Analysis** &mdash; open interest trends, buildup patterns, strike-level concentration
- **PCR Tracking** &mdash; put-call ratio monitoring with overbought/oversold signals
- **Heatmaps** &mdash; IV/volume/OI heatmaps across the strike grid
- **Options Flow** &mdash; unusual activity scanner with volume/OI ratios, premium tracking, heat scores, and bullish/bearish sentiment classification
- **Futures Analytics** &mdash; term structure, basis analysis, contract specifications
- **Expiry Calendar** &mdash; contract schedules with roll suggestions

### Portfolio & Risk Management

- **Multi-Portfolio CRUD** &mdash; holdings management with cost basis and transaction tracking
- **Allocation & Attribution** &mdash; sector allocation charts, contributor/detractor analysis
- **Benchmark Overlay** &mdash; compare against indices with relative performance metrics
- **Risk Engine** &mdash; VaR (95%), CVaR, EWMA volatility, rolling correlation, PCA factor exposures
- **Factor Analytics** &mdash; multi-factor exposure radar, attribution waterfall, rolling factor history, and factor return comparison across market, size, value, momentum, quality, and low-volatility factors
- **Stress Testing** &mdash; 6 predefined macro scenarios (GFC 2008, COVID 2020, rate shock, INR depreciation, tech rotation, commodity spike), custom shock builder, Monte Carlo simulation, and historical event replay
- **Correlation Deep Dive** &mdash; correlation matrix, rolling correlation with regime detection, hierarchical clustering with dendrogram, and cross-asset dependency visualization
- **Tax Lot Manager** &mdash; cost basis tracking across tax lots
- **Dividend Tracker** &mdash; income tracking with ex-date calendar
- **Paper Trading** &mdash; virtual trading engine with realistic order fills, slippage modeling, and TCA analytics

### Backtesting & Model Lab

- **16+ Strategy Templates** &mdash; SMA/EMA crossover, mean reversion, breakout, RSI, MACD, Bollinger Bands, dual momentum, VWAP reversion, Awesome Oscillator, Heikin-Ashi, Parabolic SAR, Dual Thrust, shooting star reversal, and Bollinger W/M patterns
- **Pair Trading Lab** &mdash; cointegration screening, hedge-ratio estimation, spread z-score diagnostics, half-life analysis, and mean-reversion trade simulations for statistical arbitrage workflows
- **Intraday & Daily Testing** &mdash; 1m to monthly resolution with session-aware logic
- **Vectorized Engine** &mdash; NumPy-based computation for fast large-dataset backtests
- **Realistic Execution** &mdash; slippage, commission, partial fills, latency, and market impact simulation
- **Result Visualization** &mdash; equity curves, drawdown charts, monthly return heatmaps, rolling Sharpe, 3D parameter surfaces, Monte Carlo paths, trade analysis
- **Walk-Forward Analysis** &mdash; out-of-sample validation with sliding windows
- **Parameter Sweep** &mdash; sensitivity analysis across hyperparameter ranges
- **Experiment Tracking** &mdash; create, run, compare, and promote models through the Model Lab
- **Model Governance** &mdash; version tracking with code/data hashing, promotion to paper trading
- **Monte Carlo Robustness** &mdash; trade/return resampling with confidence cones, terminal-wealth distribution, and probability-of-profit
- **Liquidity-Aware Execution** &mdash; fixed-bps, volume-weighted, and square-root market-impact slippage models with percent-of-volume caps
- **Strategy Tear-Sheets** &mdash; standardized HTML reports with equity, drawdown, rolling Sharpe, monthly returns, and benchmark overlay
- **Run Leaderboards** &mdash; sortable Model Lab / Portfolio Lab run comparison by Sharpe, CAGR, max drawdown, turnover, and stability

### Portfolio Lab

- **Multi-Asset Backtesting** &mdash; portfolio-level backtests with up to 200 assets
- **Weighting Modes** &mdash; equal weight, volatility target, risk parity, momentum, market cap
- **Strategy Blends** &mdash; combine up to 10 strategies with weighted sum returns
- **Rebalance Scheduling** &mdash; weekly, monthly, quarterly, or custom frequency
- **Attribution Analysis** &mdash; top contributors/detractors, worst drawdowns, rebalance log
- **Correlation Matrices** &mdash; cross-asset cluster analysis

### Cockpit, Workspaces & Intelligence

- **Cockpit Priority Stack** &mdash; a ranked daily brief across portfolio risk, alerts, catalysts, news shocks, top movers, and model signals
- **Unified Intelligence Timeline** &mdash; news, alerts, events, insider activity, earnings, corporate actions, model signals, and backtest runs in one chronological feed
- **Exposure Heatmaps** &mdash; sector, factor, currency, and correlation exposure maps across Home, Cockpit, and Risk
- **Workspace Presets** &mdash; Trader / Quant / PM / Risk / Ops presets that reconfigure dashboards, panels, and quick links
- **Saved Views** &mdash; capture and restore page, filters, ticker, tabs, columns, and chart layout across major workflows
- **AI Insight Cards** &mdash; Gemma-powered insights embedded consistently across Home, Cockpit, Screener, Portfolio, and Security Hub, with graceful offline fallback

### Cross-Asset & Macro

- **Commodities** &mdash; energy, metals, agriculture with futures term structure and seasonal analysis
- **Forex** &mdash; major pairs, cross rates matrix, central bank monitor (Fed, ECB, BoE, BoJ, RBI, and more)
- **Cryptocurrency** &mdash; full workspace with markets, movers, sectors, DeFi, derivatives, heatmaps, and correlation
- **ETF Analytics** &mdash; holdings viewer, flow tracker, multi-ETF overlap analysis
- **Mutual Funds** &mdash; search, comparison, rolling returns, SIP calculator, category rankings, fund overlap
- **Bonds** &mdash; fixed income yields, spreads, and duration analytics
- **Yield Curve** &mdash; interactive US Treasury curve with historical comparison and 2s10s inversion detection
- **Economics** &mdash; global event calendar with impact coding, macro indicators dashboard
- **Sector Rotation** &mdash; Relative Rotation Graph (RRG) with 12-week trailing momentum paths

### Alerts & Breakout Scanner

- **Multi-Condition Alert Builder** &mdash; compound rules with AND/OR logic, multi-field conditions (price, volume, RSI, MACD, moving averages), and natural-language summary
- **Multi-Channel Delivery** &mdash; in-app, email, webhook, Slack, and Telegram with per-channel configuration and delivery testing
- **Alert Lifecycle** &mdash; cooldown periods, expiry dates, max trigger limits, trigger history with deduplication
- **WebSocket Push** &mdash; real-time desktop notifications on alert trigger
- **Breakout Scanner** &mdash; automated pattern detection with confidence scoring
- **Alert History** &mdash; full timeline with delivery status and re-trigger tracking

### Operations & Compliance

- **OMS** &mdash; order management with restricted list enforcement and audit trail
- **Ops Dashboard** &mdash; feed health monitoring, kill switches, data quality panels
- **Model Governance** &mdash; model registry, approval workflows, risk limit monitoring
- **Cockpit** &mdash; executive dashboard aggregating portfolio, signals, risk, and events

### News & Sentiment

- **Ticker-Specific News** &mdash; per-symbol news feed with multi-period filtering, scoped strictly to the selected ticker
- **Sentiment Analysis** &mdash; bullish/bearish/neutral classification with confidence scores
- **Market-Wide Feed** &mdash; latest headlines with source attribution and sentiment trends
- **AI Emotion Indicator** &mdash; per-stock fear/greed gauge powered by a locally hosted **Gemma** model via **LM Studio**, surfacing a 0&ndash;100 emotion index, dominant emotion (panic &rarr; euphoria), emotion mix, and per-article bullish/bearish breakdown
- **Local & Private** &mdash; LLM sentiment runs entirely on your own machine; gracefully falls back to the lexical/FinBERT engine when LM Studio is offline

### Plugin System & Scripting

- **Plugin API** &mdash; extensible architecture for custom analysis modules
- **Included Plugins** &mdash; RSI Divergence Scanner, Sector Rotation Monitor, Unusual Volume Detector
- **Python Scripting** &mdash; sandboxed execution with security-hardened imports
- **OpenScript** &mdash; chart-based indicator scripting with library and sharing

### Real-Time Data

- **Multi-Provider WebSocket** &mdash; Zerodha Kite (India) and Finnhub (US) real-time ticks
- **Provider Waterfall** &mdash; automatic failover chain: primary → fallback → error
- **Multi-Level Caching** &mdash; L1 SQLite + L2 Redis with TTL-based invalidation
- **Candle Aggregation** &mdash; tick-by-tick to any interval with distributed bar construction
- **Redis Pub/Sub** &mdash; horizontal scaling for multi-client quote fan-out

## Architecture

```
+---------------------------------------------------+
|                   CLIENT TIER                     |
|   React 18 + TypeScript + Vite + Tailwind CSS    |
|   TanStack Query + Zustand + Lightweight Charts   |
|   Recharts + Three.js + Playwright + Vitest       |
+--------------------------+------------------------+
                           | REST API + WebSocket
+--------------------------+------------------------+
|                   API GATEWAY                     |
|   FastAPI + Uvicorn + JWT Auth + CORS Middleware  |
|   53 Route Modules (Equity, F&O, Backtest, Risk) |
+--------------------------+------------------------+
                           |
+--------------------------+------------------------+
|                  SERVICE LAYER                    |
|   Unified Fetcher + Screener Engine + Model Lab  |
|   Risk Engine + Alert Scheduler + Quote Hub      |
|   Provider Registry + Failover Chain             |
+--------------------------+------------------------+
                           |
+--------------------------+------------------------+
|                 DATA PROVIDERS                    |
|   Zerodha Kite | Finnhub | FMP | Yahoo Finance  |
|   NSEPython (F&O, Corporate Actions)             |
+--------------------------+------------------------+
                           |
+--------------------------+------------------------+
|                  PERSISTENCE                      |
|   SQLite (default) | PostgreSQL 16 (production)  |
|   Redis (cache + pub/sub + sessions)             |
+---------------------------------------------------+
```

### Data Flow

Market data flows through a unified pipeline:

1. **Exchange ticks** arrive via WebSocket adapters (Kite, Finnhub)
2. **Quote Hub** fans out ticks to connected clients via `/api/ws/quotes`
3. **Bar Aggregator** constructs OHLCV candles at all supported intervals
4. **OHLCV Cache** persists bars in SQLite (L1) and Redis (L2)
5. **Unified Fetcher** serves chart requests with cache-first, provider-fallback semantics
6. **Chart Engine** renders via Lightweight Charts v5 with indicator overlays

### Provider Waterfall

```
Request → L1 Cache (SQLite) → L2 Cache (Redis) → Primary Provider → Fallback Provider → 503
             HIT → return         HIT → return       OK → cache+return    OK → cache+return
```

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Linux, macOS, Windows 10+ | Ubuntu 22.04+ / macOS 13+ |
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8 GB+ |
| Disk | 2 GB | 10 GB+ (historical data cache) |
| Display | 1280 x 720 | 1920 x 1080+ |
| Browser | Chrome 90+, Firefox 90+, Safari 15+, Edge 90+ | Latest Chrome or Firefox |

### Software Dependencies

| Software | Version | Notes |
|----------|---------|-------|
| Docker | 20.10+ | Required for containerized deployment |
| Docker Compose | v2.0+ | Included with Docker Desktop |
| Python | 3.11+ | Local development only |
| Node.js | 22+ | Local frontend development only |
| Git | 2.30+ | For cloning the repository |

## Quick Start

### One command (recommended)

```bash
git clone https://github.com/Hitheshkaranth/OpenTerminalUI.git
cd OpenTerminalUI
./install.sh          # macOS / Linux / WSL   (Windows: ./install.ps1)
```

That's it. The installer **detects your host OS** (macOS, Linux, WSL, or Windows)
and adapts, then:

- creates a single `.env` from `.env.example`,
- auto-generates strong `JWT_SECRET_KEY` and `CACHE_SIGNING_KEY` (no secret errors),
- auto-generates a **unique admin password** and seeds an admin account, so there
  are **no login errors** on first launch,
- uses **Docker if available, otherwise a local Python + Node setup** (auto-detected),
- launches the app at `http://localhost:8000` and **prints your login credentials**.

**Prerequisites:** either Docker (Desktop/Engine with the daemon running) *or*, for
the local path, Python 3.11+ and Node 20+. Nothing else to configure.

**First login:** when the installer finishes it prints something like:

```
 OpenTerminalUI is ready  ->  http://localhost:8000
   email:    admin@openterminal.local
   password: <generated unique password>
```

The same credentials are saved in your `.env` (`BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD`). Change the password after first login. Seeding is
skipped automatically once any user exists, so re-running never clobbers data.

Force a mode if you prefer: `OTUI_MODE=docker ./install.sh` or `OTUI_MODE=local ./install.sh`.

**Stopping / restarting (Docker):**

```bash
docker compose down        # stop (keeps your data + seeded admin)
docker compose down -v      # stop and wipe the database (fresh start next time)
./install.sh                # start again
```

### Adding API keys (one place, guided)

All keys live in the single repo-root `.env`. The easiest way to add or update
them is the interactive wizard, which shows what each key unlocks:

```bash
make keys          # or: ./scripts/setup-keys.sh
```

All keys are optional — the platform runs on built-in fallback data without them.

### Manual alternatives

<details>
<summary>Docker by hand</summary>

```bash
cp .env.example .env      # add API keys if you have them
docker compose up --build            # Backend + Frontend + Redis (SQLite)
docker compose --profile postgres up --build   # with PostgreSQL
```
</details>

<details>
<summary>Local development (hot reload)</summary>

```bash
# Backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
PYTHONPATH=. uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

# Frontend (separate terminal)
cd frontend && npm ci && npm run dev
```

- Backend API: `http://127.0.0.1:8000`
- Frontend dev server: `http://127.0.0.1:5173`
</details>

## Environment Variables

The platform runs without API keys using fallback providers. Add keys to unlock full data access:

| Variable | Purpose |
|----------|---------|
| `FMP_API_KEY` | Financial Modeling Prep &mdash; US equities, fundamentals, earnings |
| `FINNHUB_API_KEY` | Finnhub &mdash; US real-time WebSocket ticks |
| `KITE_API_KEY` | Zerodha Kite &mdash; India NSE/BSE real-time + historical |
| `KITE_API_SECRET` | Zerodha Kite secret |
| `KITE_ACCESS_TOKEN` | Zerodha Kite session token |
| `JWT_SECRET_KEY` | JWT signing key for authentication (auto-generated by `install.sh`) |
| `CACHE_SIGNING_KEY` | Cache integrity signing key (auto-generated by `install.sh`) |
| `BOOTSTRAP_ADMIN_EMAIL` | Email for the first-run admin account (default `admin@openterminal.local`) |
| `BOOTSTRAP_ADMIN_PASSWORD` | Password for the first-run admin (auto-generated by `install.sh`; seeding is skipped once any user exists) |
| `DATABASE_URL` | Database connection (default: SQLite) |
| `REDIS_URL` | Redis connection for caching and pub/sub |
| `OPENTERMINALUI_CORS_ORIGINS` | Allowed CORS origins |
| `OPENTERMINALUI_PREFETCH_ENABLED` | Enable background data prefetch |
| `LM_STUDIO_BASE_URL` | LM Studio OpenAI-compatible endpoint (default `http://localhost:1234/v1`; use `http://host.docker.internal:1234/v1` from Docker) |
| `LM_STUDIO_MODEL` | Gemma model id loaded in LM Studio (default `google/gemma-4-26b-a4b`) |
| `LM_STUDIO_ENABLED` | Toggle the LLM emotion analysis (default `true`; falls back to lexical sentiment when off) |
| `OPENROUTER_API_KEY` | OpenRouter key powering the AI research agent (free `:free` models work) |
| `AGENT_PROVIDER` | Agent LLM provider: `openrouter` \| `openai` \| `lmstudio` (default `openrouter`) |
| `AGENT_MODEL` | Primary agent model id (default `openai/gpt-oss-20b:free`) |
| `AGENT_FALLBACK_MODELS` | Comma-separated models tried when the primary is rate-limited (429) or unavailable (404) |
| `AGENT_DEBATE_ENABLED` | Enable multi-agent debate mode in the agent console (default `true`) |

## AI News Sentiment with Gemma 4 (LM Studio)

OpenTerminalUI integrates a locally hosted **Google Gemma 4** model, served through
[LM Studio](https://lmstudio.ai/), to power the per-stock **AI Emotion Indicator**
on the News workspace. The model reads recent headlines for a ticker and returns a
structured judgement &mdash; sentiment, confidence, and a market emotion &mdash; which
the backend aggregates into a 0&ndash;100 fear/greed index, a dominant emotion, an
emotion mix, and per-article bullish/bearish signals. All inference runs on your own
machine; no news or prompt data leaves your hardware.

### How it works

```
News (DB / Yahoo / Google RSS)
        │
        ▼
backend/services/stock_emotion.py ──▶ backend/services/lm_studio_client.py
   (batch prompt + JSON schema)          (OpenAI-compatible /v1/chat/completions)
        │                                          │
        │                                          ▼
        │                                   LM Studio  ·  Gemma 4
        ▼
GET /api/sentiment/emotion/{ticker}  ──▶  Emotion Indicator (News page)
```

- All articles for a ticker are analyzed in a **single batched request** (large local
  models are slow &mdash; per-article calls would pay the latency N times over).
- The request uses LM Studio **structured output** (`json_schema`) so the model is
  constrained to valid, parseable JSON.
- If LM Studio is disabled or unreachable, the feature **falls back** to the built-in
  lexical / FinBERT sentiment engine, so the endpoint always returns a result.

### Integration procedure

1. **Install LM Studio** &mdash; download from [lmstudio.ai](https://lmstudio.ai/) (macOS,
   Windows, Linux).
2. **Download a Gemma model** &mdash; in LM Studio's *Discover* tab, search for and
   download a **Gemma** model (e.g. `google/gemma-4-26b-a4b`, or a smaller Gemma
   variant for faster responses).
3. **Load the model and start the server** &mdash; load the model, open the
   *Developer / Local Server* tab, and click **Start Server**. It listens on
   `http://localhost:1234` and exposes the OpenAI-compatible API at `/v1`.
4. **Note the model id** &mdash; copy the exact model id shown by LM Studio
   (visible at `http://localhost:1234/v1/models`); you will set it as `LM_STUDIO_MODEL`.
5. **Configure OpenTerminalUI**:
   - **Local development** &mdash; add to `.env` (defaults already point at localhost):
     ```bash
     LM_STUDIO_BASE_URL=http://localhost:1234/v1
     LM_STUDIO_MODEL=google/gemma-4-26b-a4b
     LM_STUDIO_ENABLED=true
     ```
   - **Docker** &mdash; the container must reach LM Studio on the *host*. `docker-compose.yml`
     already defaults `LM_STUDIO_BASE_URL` to `http://host.docker.internal:1234/v1` and
     maps `host.docker.internal`. Override `LM_STUDIO_MODEL` via `.env` if your model id
     differs.
6. **Restart the backend** (or `docker compose up -d`) so the new settings load.
7. **Verify** &mdash; open the **News** workspace, select any ticker, and check the
   *Emotion Indicator* badge:
   - `Gemma · <model id>` &mdash; the model is live and analyzing.
   - `Lexical fallback` &mdash; LM Studio was unreachable; the built-in engine was used.

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `LM_STUDIO_BASE_URL` | `http://localhost:1234/v1` | LM Studio OpenAI-compatible endpoint. Use `http://host.docker.internal:1234/v1` from Docker. |
| `LM_STUDIO_MODEL` | `google/gemma-4-26b-a4b` | Model id loaded in LM Studio. Must match exactly. |
| `LM_STUDIO_ENABLED` | `true` | Master toggle for LLM emotion analysis. |
| `LM_STUDIO_TIMEOUT_SECONDS` | `240` | Per-request timeout for the model call. |

These can also be set under `app:` in `config/settings.yaml`.

> **Performance:** large models such as `gemma-4-26b-a4b` are slow on consumer
> hardware &mdash; the first analysis for a ticker can take a minute or more (results
> are then cached). For a snappier experience, load a smaller Gemma / instruct model
> in LM Studio and point `LM_STUDIO_MODEL` at it.

## Testing

### Backend

```bash
PYTHONPATH=. python -m compileall backend
PYTHONPATH=. pytest backend/tests -q --cov=backend --cov-fail-under=45
```

### Frontend

```bash
cd frontend
npm run build
npx vitest run
```

### End-to-End

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

### Gate (all checks)

```bash
make gate
```

## Repository Layout

```
backend/                 FastAPI app, adapters, services, routes, tests
  adapters/              Market data provider adapters
  agent/                 AI research agent: orchestrator, tools, debate roles
  api/routes/            53 route modules (equity, fno, backtest, risk, oms, ...)
  core/                  Unified fetcher, failover, service status
  services/              48 business logic modules
  db/                    SQLAlchemy ORM, migrations, caching
  auth/                  JWT authentication and middleware
  config/                Settings, environment, security
  tests/                 409+ backend tests
frontend/                React + Vite + TypeScript SPA
  src/agent/             AI agent console, SSE client, artifact + markdown UI
  src/pages/             51 page components
  src/components/        UI components, terminal design system
  src/fno/               F&O workspace modules
  src/store/             Zustand state management
  src/__tests__/         234+ unit tests
  tests/e2e/             Playwright E2E specs
plugins/                 Extensible plugin system with examples
docs/                    Wiki, architecture specs, and contributor docs
  site/                  GitHub Pages website
  wiki/                  Getting started, contributing guides
data/                    Local SQLite databases and test fixtures
docker-compose.yml       Container orchestration (backend + Redis + Postgres)
Dockerfile               Multi-stage build (Node builder + Python runtime)
Makefile                 Development commands (setup, test, gate)
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+G` | GO Bar &mdash; symbol lookup and navigation |
| `Ctrl+K` | Command Palette &mdash; fuzzy search across all features |
| `Ctrl+J` | AI Research Agent &mdash; toggle the agent console |
| `F1`-`F9` | Function keys for workspace switching |
| `1`-`7` | Timeframe hotkeys in chart views |
| `Esc` | Close active panel or dialog |

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

1. Fork the repo and create a branch: `feat/your-feature` or `fix/your-fix`
2. Write tests first (TDD encouraged)
3. Run `make gate` to pass all checks
4. Open a PR with a clear description

## License

[MIT](LICENSE) &mdash; free to use, modify, and distribute.
