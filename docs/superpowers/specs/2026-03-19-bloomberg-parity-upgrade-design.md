# Bloomberg Parity Upgrade — Design Specification

**Date:** 2026-03-19
**Author:** Claude (Lead Architect / PM)
**Approach:** B — Bloomberg Core + TradingView UX
**Hard Constraint:** All existing features and functionality preserved — zero regressions
**Forge Program:** R7-BLOOMBERG-PARITY

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Inventory](#2-current-state-inventory)
3. [Gap Analysis vs Bloomberg/TradingView/Eikon](#3-gap-analysis)
4. [Section 1 — Navigation & Interface Overhaul](#4-section-1--navigation--interface-overhaul)
5. [Section 2 — Multi-Asset Expansion](#5-section-2--multi-asset-expansion)
6. [Section 3 — Pro Analytics](#6-section-3--pro-analytics)
7. [Section 4 — TradingView-Inspired Charting UX](#7-section-4--tradingview-inspired-charting-ux)
8. [Section 5 — Intelligence Layer & Community](#8-section-5--intelligence-layer--community)
9. [Forge Task Matrix](#9-forge-task-matrix)
10. [Swarm Topology & Execution Plan](#10-swarm-topology--execution-plan)
11. [Regression & QC Gates](#11-regression--qc-gates)
12. [File Lock Domains](#12-file-lock-domains)
13. [Data Provider Strategy](#13-data-provider-strategy)
14. [Risk Register](#14-risk-register)

---

## 1. Executive Summary

OpenTerminalUI is a mature financial terminal (41 pages, 200+ API endpoints, 35+ services) covering equity, FNO, crypto, backtesting, and portfolio management. This upgrade closes the critical feature gaps versus Bloomberg Terminal and TradingView, organized into 4 parallel execution swarms with 34 Codex implementation tasks and 34 Gemini QC tasks.

**Scope:**
- Navigation overhaul (Bloomberg GO-bar behavior, context menus, symbol linking, hotlists, multi-monitor)
- Multi-asset expansion (Commodities, Forex, ETF Analytics, Bond Screener, Mutual Fund enhancement)
- Pro analytics (Market Depth/L2, Performance Attribution, Stress Testing, TCA frontend, Custom Ratios, Peer Relative Valuation)
- TradingView-inspired charting (OpenScript IDE, Pattern Recognition, Alerts on Drawings, Anchored VWAP, Volume Footprint, 8-symbol overlay)
- Intelligence layer (ESG scores, Fund Flows, Industry Analysis, AI Brief, Economic Calendar on charts, Community)

**Out of scope:** FIX protocol, internal messaging (IB/MSG), structured products, DCM, full BI clone, ML model serving.

---

## 2. Current State Inventory

### Frontend (41 Pages)

| Domain | Pages | Maturity |
|--------|-------|----------|
| Equity Core | StockDetail, SecurityHub, Dashboard, Compare, SectorRotation | 85% |
| Chart | ChartWorkstation (6-panel), TradingChart, 80+ indicators, drawing tools, replay | 85% |
| Screener | ScreenerPage + 18 viz types, AST expression parser, multi-market | 90% |
| FNO/Options | OptionChain, Greeks, Futures, OI Analysis, Strategy, PCR, Heatmap, Expiry | 80% |
| Crypto | CryptoWorkspace (8 tabs: markets, movers, heatmap, derivatives, defi, correlation) | 75% |
| Portfolio | Portfolio, PortfolioLab, PortfolioLabBlends, PortfolioLabDetail | 80% |
| Backtesting | Backtesting (mosaic, 11+ panels, 3D viz), ModelLab, ModelGovernance | 75% |
| Trading | PaperTrading, OMS Compliance, OpsDashboard, Cockpit | 70% |
| Navigation | CommandPalette (24 cmds), IconRail (10 items), Sidebar (28 items), TopBar, StatusBar | 85% |
| Fixed Income | YieldCurveDashboard | 60% |
| Economics | EconomicTerminal | 65% |
| Other | News, Alerts, Watchlist, Settings, Account, Plugins, BreakoutScanner, Home, Launchpad | 75% |

### Backend (43 Route Files, 35+ Services)

| Domain | Routes | Services | Maturity |
|--------|--------|----------|----------|
| Market Data | quotes, chart, stream (WS), data, data_layer | marketdata_hub, candle_aggregator, finnhub_ws, kite_stream, us_tick_stream, price_series | 85% |
| Screening | screener, breakouts | screener engine (AST), scanner_engine, breakout_engine | 90% |
| Portfolio | portfolio, portfolios | portfolio_analytics | 80% |
| Trading | oms, paper | paper_trading_engine, oms_service | 70% |
| Alerts | alerts | alert_evaluator, scanner_alert_scheduler | 80% |
| FNO | options, futures (in fno/) | option_chain_fetcher | 80% |
| Crypto | crypto | crypto_market_service | 75% |
| Fundamentals | fundamentals, valuation, peers | data_fetcher, fundamental_scores | 85% |
| News | news | news_ingestor, sentiment_engine | 75% |
| Backtesting | backtests, backtest | backtest_jobs, backtester | 75% |
| Economics | economics, fixed_income | economic_data, fixed_income_service | 60% |
| Infrastructure | health, admin, search, export, audit, governance, ops, user_layouts, kite | cache, scheduler, provider_registry, data_quality_monitor | 85% |

### Design System

- 16 terminal primitives (TerminalButton, TerminalInput, TerminalTable, DenseTable, etc.)
- 4 theme variants (Terminal Noir, Classic Bloomberg, Light Desk, Custom)
- 200+ CSS custom properties (`--ot-*` prefix)
- Density modes (dense/compact/normal/comfortable)
- Keyboard-first navigation with ARIA accessibility
- PanelChrome, SplitPane, LaunchpadWorkspace layout system

### Real-Time Architecture

- India: Kite WebSocket → MarketDataHub → `/ws/quotes` → useQuotesStore
- US: Finnhub WS → US Tick Stream → `/ws/quotes` → useUSQuotesStore
- Polling fallback: priceStream.ts (1.5s interval)
- Candle aggregation: tick → 1m → higher timeframes
- Alert streaming: `/ws/alerts` → toast + browser notification

---

## 3. Gap Analysis

### vs Bloomberg Terminal — Critical Missing Features

| Bloomberg Feature | Status in OpenTerminalUI | Priority |
|---|---|---|
| GO Bar with history + preview | Partial (CommandPalette exists, no history/preview) | P0 |
| Right-click context menus | Missing entirely | P0 |
| Color-coded symbol linking | Missing (only crosshair sync exists) | P0 |
| Hotlists (gainers/losers/active) | Missing | P0 |
| Multi-monitor tear-off | Partial (LaunchpadPopout exists, no sync) | P1 |
| Market Depth / Level 2 (ALLQ) | Missing (stub panel in Launchpad) | P0 |
| Performance Attribution (PORT) | Missing | P0 |
| Stress Testing (MARS) | Missing | P1 |
| TCA (Transaction Cost Analysis) | Backend exists, no frontend | P1 |
| Custom Ratio Builder (FLDS) | Partial (AdvancedArithmetic exists) | P1 |
| Peer Relative Valuation (RV) | Partial (basic peer comparison) | P1 |
| Commodities coverage | Missing entirely | P0 |
| Forex / FX coverage | Missing entirely | P0 |
| ETF Analytics | Missing | P1 |
| Bond/Credit Screener | Missing (yield curve only) | P2 |
| ESG Scores | Missing | P1 |
| Fund Flows (FII/DII) | Missing | P1 |
| Industry Analysis | Missing | P2 |
| Navigation history / breadcrumbs | Missing | P1 |

### vs TradingView — Critical Missing Features

| TradingView Feature | Status in OpenTerminalUI | Priority |
|---|---|---|
| Pine Script (custom scripting) | Backend stub, no frontend IDE | P0 |
| Chart Pattern Recognition | Missing (breakout has range/volume only) | P1 |
| Alerts on Drawing Tools | Missing | P1 |
| Anchored VWAP | Missing | P1 |
| Volume Footprint Chart | Missing | P2 |
| 8-symbol overlay | Partial (3 symbols max) | P1 |
| Chart Templates (shareable) | Backend model exists, no UI | P1 |
| Symbol search with preview | Missing | P2 |
| Economic events on chart | Missing (calendar page exists separately) | P1 |
| Community / Social layer | Partial (PublicScreens exists) | P2 |

### vs Refinitiv Eikon — Critical Missing Features

| Eikon Feature | Status | Priority |
|---|---|---|
| ESG Analytics | Missing | P1 |
| Fund Flow Analytics | Missing | P1 |
| Supply Chain mapping | Missing | P2 |
| Credit Rating History | Missing (yield curve only) | P2 |

---

## 4. Section 1 — Navigation & Interface Overhaul

### 1.1 Bloomberg GO-Bar Enhancement

**Current state:** CommandBar at top + CommandPalette (Ctrl+K) with 24 command codes and fuzzy search.

**Changes:**
- Add `recentSecurities[]` ring buffer (20 items) to SettingsStore, persisted in localStorage
- GO bar shows recent stack on focus (Up/Down arrows to navigate history)
- Inline preview card (mini sparkline + price + change%) appears as user types — debounced 300ms
- Sub-function routing: parse `TICKER FUNC SUBFUNC` → navigate to page with tab pre-selected
- Asset class disambiguation dropdown when multiple types match a query

**New files:**
- `frontend/src/hooks/useRecentSecurities.ts`

**Modified files:**
- `frontend/src/components/layout/CommandBar.tsx`
- `frontend/src/components/layout/TopBar.tsx`
- `frontend/src/components/layout/commanding.ts`
- `frontend/src/components/layout/CommandPalette.tsx`
- `frontend/src/store/settingsStore.ts`

### 1.2 Context Menus (Right-Click Actions)

**Current state:** No standardized right-click context menus.

**Changes:**
- Create shared `<SymbolContextMenu>` component (Radix UI context menu)
- Standard actions: View Chart, Security Hub, Add to Watchlist, Create Alert, Compare, Copy Ticker
- Attach to every component displaying a ticker symbol
- Extensible action registry for page-specific custom actions

**New files:**
- `frontend/src/components/common/SymbolContextMenu.tsx`

**Integration points (existing files modified for context menu attachment):**
- All TerminalTable/DenseTable instances displaying ticker columns
- Watchlist rows, screener results, portfolio holdings, news article tickers
- Chart panel headers, Launchpad panel headers

### 1.3 Symbol Linking (Color-Coded Groups)

**Current state:** ChartWorkstation has `syncCrosshair` and `syncTimeframe` booleans only.

**Changes:**
- Add `linkGroup: 'red' | 'blue' | 'green' | 'yellow' | 'none'` to panel state
- Shared `SymbolLinkContext` — symbol change in group X propagates to all panels in group X
- Color dot on PanelChrome header, click to cycle groups
- Applies to: Chart panels, watchlist, news, security hub, fundamentals, portfolio detail

**New files:**
- `frontend/src/contexts/SymbolLinkContext.tsx`

**Modified files:**
- `frontend/src/components/layout/PanelChrome.tsx`
- `frontend/src/store/chartWorkstationStore.ts`

### 1.4 Hotlists (Real-Time Sorted Lists)

**Current state:** No dynamic hotlists.

**Changes:**
- New `HotlistPage` with tabs: Gainers, Losers, Most Active, 52W High, 52W Low, Gap Up, Gap Down, Unusual Volume
- Backend endpoint fed by MarketDataHub ticks + materialized store
- Auto-refresh every 5s during market hours
- Inline sparkline + change% + volume bar per row
- Right-click context menu on every row

**New files:**
- `frontend/src/pages/Hotlists.tsx`
- `backend/api/routes/hotlists.py`
- `backend/services/hotlist_service.py`
- `backend/tests/test_hotlists.py`

**Modified files:**
- `frontend/src/App.tsx` (add route)
- `frontend/src/components/layout/Sidebar.tsx` (add nav item)
- `frontend/src/components/layout/commanding.ts` (add HOT command)

### 1.5 Multi-Monitor / Tear-Off Panels

**Current state:** `LaunchpadPopout.tsx` exists but limited — no cross-window sync.

**Changes:**
- Extend popout mechanism with `BroadcastChannel` API for cross-window symbol sync
- "Pop out" button on every PanelChrome header
- Popout windows inherit theme, link group, and WebSocket subscriptions
- On close, panel returns to original position

**Modified files:**
- `frontend/src/components/layout/PanelChrome.tsx`
- `frontend/src/pages/LaunchpadPopout.tsx`
- `frontend/src/contexts/SymbolLinkContext.tsx`

### 1.6 Recently Viewed & Breadcrumb Trail

**Current state:** No history tracking, basic breadcrumbs.

**Changes:**
- Persist last 50 navigation events in `navigationHistoryStore`
- Breadcrumb trail in TopBar: `Home > Equity > AAPL > Financials > Margins`
- `Alt+Left` keyboard shortcut for back navigation
- "Recent" section in CommandPalette showing last 10 pages

**New files:**
- `frontend/src/hooks/useNavigationHistory.ts`
- `frontend/src/store/navigationStore.ts`

**Modified files:**
- `frontend/src/components/layout/TopBar.tsx`
- `frontend/src/components/layout/CommandPalette.tsx`

---

## 5. Section 2 — Multi-Asset Expansion

### 2.1 Commodities Terminal

**New page:** `/equity/commodities`

**Tab groups:**
- Energy: Crude Oil (WTI/Brent), Natural Gas, Heating Oil, Gasoline
- Metals: Gold, Silver, Platinum, Palladium, Copper
- Agriculture: Wheat, Corn, Soybeans, Cotton, Sugar, Coffee

**Components:** Price table with sparklines, term structure chart (reuse FuturesTermStructure), seasonal overlay chart, inventory timeline.

**Data source:** FMP commodity quotes; Yahoo Finance OHLCV (`GC=F`, `CL=F`, etc.)

**New files:**
- `frontend/src/pages/Commodities.tsx`
- `backend/api/routes/commodities.py`
- `backend/services/commodity_service.py`
- `backend/tests/test_commodities.py`

### 2.2 Forex / FX Terminal

**New page:** `/equity/forex`

**Components:**
- Cross Rates Matrix — 8x8 grid (USD, EUR, GBP, JPY, CHF, AUD, CAD, INR)
- Pair Detail — chart + technicals + economic calendar events
- Central Bank Monitor — rate decisions calendar + current rates
- Majors Heatmap — G10 relative strength

**Data source:** Yahoo Finance FX pairs (`EURUSD=X`), Finnhub forex quotes

**New files:**
- `frontend/src/pages/Forex.tsx`
- `frontend/src/components/forex/CrossRatesMatrix.tsx`
- `frontend/src/components/forex/CentralBankMonitor.tsx`
- `backend/api/routes/forex.py`
- `backend/services/forex_service.py`
- `backend/tests/test_forex.py`

### 2.3 ETF Analytics

**New page:** `/equity/etf`

**Components:**
- ETF Screener — Filter by: asset class, expense ratio, AUM, tracking error, sector exposure
- Holdings Viewer — Top holdings with weight%, sector donut
- Overlap Analysis — Compare 2-3 ETFs, show shared holdings
- Flow Tracker — Weekly/monthly inflow/outflow bar chart
- Expense Ratio Comparison — side-by-side table

**Data source:** FMP ETF holdings/profile; Yahoo Finance price data

**New files:**
- `frontend/src/pages/ETFAnalytics.tsx`
- `frontend/src/components/etf/HoldingsViewer.tsx`
- `frontend/src/components/etf/OverlapAnalysis.tsx`
- `frontend/src/components/etf/FlowTracker.tsx`
- `backend/api/routes/etf.py`
- `backend/services/etf_service.py`
- `backend/tests/test_etf.py`

### 2.4 Mutual Fund Enhancement

**Enhanced page:** Existing `/equity/mutual-funds`

**New tabs:** Category Rankings, Rolling Returns, SIP Calculator, Fund Overlap

**New files:**
- `backend/api/routes/mutual_funds.py` (extend)
- `backend/tests/test_mutual_funds.py`

### 2.5 Bond / Credit Screener

**New page:** `/equity/bonds`

**Components:**
- Bond Screener — Filter by: maturity, coupon, rating, yield, duration, issuer type
- Credit Spread Monitor — IG vs HY spread timeline
- Rating Migration Tracker — recent upgrades/downgrades

**Data source:** India GSec via RBI feeds; US treasuries via FRED API

**New files:**
- `frontend/src/pages/Bonds.tsx`
- `backend/api/routes/bonds.py`
- `backend/services/bond_service.py`
- `backend/tests/test_bonds.py`

---

## 6. Section 3 — Pro Analytics

### 3.1 Market Depth / Level 2

**New component:** `<OrderBookPanel>` with three views:
- Ladder View — bid/ask size at each price level
- Depth Chart — cumulative bid/ask as mirrored area chart
- Time & Sales Tape — scrolling trade log

**Data source:** Kite WS (India bid/ask), Finnhub trades (US), Binance depth (crypto)

**Backend:** New `/api/depth/{symbol}` REST + extend `/ws/quotes` with `depth` message type

**New files:**
- `frontend/src/components/market/OrderBookPanel.tsx`
- `frontend/src/components/market/DepthChart.tsx`
- `frontend/src/components/market/TimeSalesTape.tsx`
- `backend/api/routes/depth.py`
- `backend/services/orderbook_service.py`
- `backend/tests/test_depth.py`

### 3.2 Performance Attribution (Brinson Model)

**New component:** `<AttributionPanel>` on Portfolio page

**Analytics:**
- Brinson-Fachler Decomposition (Allocation + Selection + Interaction)
- Sector Attribution Table
- Rolling Attribution Time Series
- Factor Attribution (Market, Size, Value, Momentum, Quality, Volatility)

**Backend:** Extend `portfolio_analytics.py` with `compute_brinson_attribution()`

**New files:**
- `frontend/src/components/portfolio/AttributionPanel.tsx`
- `frontend/src/components/portfolio/FactorAttributionChart.tsx`
- `backend/tests/test_attribution.py`

### 3.3 Stress Testing & Scenario Analysis

**New component:** `<StressTestPanel>` on Risk Dashboard

**Features:**
- Predefined Scenarios (2008 GFC, 2020 COVID, 2013 Taper, 2022 Rates, Custom)
- Custom Scenario Builder (sliders: equity ±X%, rates ±Ybps, oil ±Z%, FX ±W%)
- Impact Table (per-holding stressed value, P&L, contribution)
- Historical Replay (actual crisis returns applied to current portfolio)

**New files:**
- `frontend/src/components/risk/StressTestPanel.tsx`
- `frontend/src/components/risk/ScenarioBuilder.tsx`
- `backend/services/stress_test_service.py`
- `backend/tests/test_stress.py`

### 3.4 TCA Frontend

**New page:** `/equity/tca`

**Components:**
- Shortfall Waterfall (Decision → Arrival → VWAP → Execution → Total Cost)
- Cost Decomposition Table (per-trade: timing, market impact, spread, commission)
- Broker Scorecard
- Time-of-Day Analysis (average cost by hour heatmap)
- Volume Participation (execution vs market volume timeline)

**Backend:** Wire existing TCA service to new `/api/tca/analysis/{portfolio_id}`

**New files:**
- `frontend/src/pages/TCA.tsx`
- `frontend/src/components/tca/ShortfallWaterfall.tsx`
- `frontend/src/components/tca/CostDecomposition.tsx`
- `frontend/src/components/tca/BrokerScorecard.tsx`
- `backend/api/routes/tca.py`

### 3.5 Custom Ratio Builder

**New component:** `<CustomRatioBuilder>` modal

**Features:**
- Formula input with autocomplete (reuse AST parser)
- Name, description, category tagging
- Preview computation on sample data
- Saved ratios appear as columns in Screener, Security Hub, Portfolio

**Backend:** New `/api/custom-ratios` CRUD, `CustomRatioORM` model

**New files:**
- `frontend/src/components/analysis/CustomRatioBuilder.tsx`
- `backend/api/routes/custom_ratios.py`
- `backend/models/custom_ratio.py`

### 3.6 Peer Relative Valuation Matrix

**Enhanced component:** Existing `PeersComparison.tsx`

**Additions:**
- Z-Score columns (standard deviations from peer median)
- Percentile rank (color-coded cell backgrounds)
- Historical range bars (current value within 5-year range)
- Sector-relative toggle
- Custom peer group selection

---

## 7. Section 4 — TradingView-Inspired Charting UX

### 4.1 OpenScript IDE (Pine Script Equivalent)

**New component:** `<ScriptEditor>` panel in Chart Workstation

**Language DSL:**
- Built-in functions: `sma()`, `ema()`, `rsi()`, `crossover()`, `crossunder()`, `highest()`, `lowest()`
- Variables: `open`, `high`, `low`, `close`, `volume`
- Output: `plot()`, `hline()`, `bgcolor()`, `alertcondition()`

**Features:**
- Monaco Editor with custom syntax highlighting
- Live preview on active chart
- Script library (save/load/share)
- Error panel with inline diagnostics

**Security:** AST whitelist validation (same approach as screener parser — NO eval)

**New files:**
- `frontend/src/components/chart/ScriptEditor.tsx`
- `frontend/src/components/chart/ScriptLibrary.tsx`
- `backend/services/openscript_compiler.py`
- `backend/models/user_script.py`
- `backend/tests/test_openscript.py`

### 4.2 Chart Pattern Recognition

**New plugin:** `<PatternOverlay>` for ChartEngine

**Patterns:** Head & Shoulders (regular + inverse), Double Top/Bottom, Triple Top/Bottom, Ascending/Descending/Symmetrical Triangle, Rising/Falling Wedge, Bull/Bear Flag, Cup & Handle, Channel

**Approach:** Deterministic pivot point detection + geometric rule matching (not ML)

**New files:**
- `backend/services/pattern_recognition_service.py`
- `backend/api/routes/patterns.py`
- `frontend/src/shared/chart/patternOverlay.ts`
- `backend/tests/test_patterns.py`

### 4.3 Alerts on Drawing Tools

**Extension:** drawingEngine.ts + DrawingTools.tsx

**Mechanism:**
- Optional `alert` field on `NormalizedChartDrawing`
- Context menu: "Create Alert on This Drawing"
- Backend: new `drawing_cross` condition type in AlertEvaluatorService
- For diagonal lines: interpolate slope at each bar

### 4.4 Anchored VWAP

**New drawing tool type:** `anchored_vwap`

- Click bar → VWAP computed from that point forward
- Frontend computation (cumulative price×volume / cumulative volume)
- Optional ±1σ, ±2σ bands
- Multiple simultaneous anchored VWAPs

**New files:**
- `frontend/src/shared/chart/anchoredVwap.ts`

### 4.5 Volume Footprint Chart

**New chart type:** "Footprint"

- Each candle shows bid vs ask volume at each price level
- Delta row (net ask-bid) at bottom
- Color intensity scales with volume
- Requires tick-level data (Kite, Finnhub, Binance)

**New files:**
- `backend/services/footprint_aggregator.py`
- `frontend/src/shared/chart/footprintRenderer.ts`
- `backend/tests/test_footprint.py`

### 4.6 Multi-Symbol Overlay (8 Symbols)

**Extension:** `comparison.ts`
- Expand from 3 to 8 symbols
- Extended color palette
- Legend with toggle visibility per symbol

### 4.7 Chart Templates Manager

**New component:** `<TemplateManager>` drawer

- Save/load named templates (chart type + indicators + drawing style)
- Pre-built templates (10 seeded: Swing Trader, Scalper, Ichimoku, etc.)
- Quick apply, import/export JSON

**New files:**
- `frontend/src/components/chart-workstation/TemplateManager.tsx`

### 4.8 Symbol Search with Preview

**Extension:** TopBar search dropdown

- Hover preview card: mini sparkline + price + change% + market cap + sector
- Debounced 200ms
- Uses existing `/api/quotes` and SparkLine component

---

## 8. Section 5 — Intelligence Layer & Community

### 5.1 ESG Scores

**New tab:** Security Hub → "ESG"

- Score card (E/S/G + composite radar chart)
- Peer ESG ranking
- Controversy timeline
- Carbon metrics
- ESG trend (3-year line chart)
- Screener integration (ESG fields added to field picker)

**New files:**
- `backend/api/routes/esg.py`
- `backend/services/esg_service.py`
- `backend/tests/test_esg.py`

### 5.2 Fund Flow Analytics

**New panel:** Dashboard → "Fund Flows"

- Sector Flow Heatmap (sectors vs time periods)
- ETF Flow Table (top inflows/outflows)
- FII/DII Flow Summary (India market — critical for NSE traders)
- Cumulative Flow Trend Chart

**New files:**
- `backend/api/routes/flows.py`
- `backend/services/flow_ingestor.py`
- `backend/tests/test_flows.py`

### 5.3 Industry Analysis

**New tab:** Security Hub → "Industry"

- Competitive Landscape table (top companies in same industry)
- Industry Metrics (sector-level aggregates)
- Supply Chain Map (Suppliers → Company → Customers table)
- Market Share Treemap

**New files:**
- `backend/api/routes/industry.py`

### 5.4 Economic Calendar on Chart

**New plugin:** `<EventMarkerPlugin>` for ChartEngine

- Vertical markers: Earnings (E), Dividend (D), Economic (star), Corporate Action (C)
- Hover tooltip with event details
- Toggle in chart toolbar, `Shift+E` hotkey

**New files:**
- `frontend/src/shared/chart/eventMarkerPlugin.ts`

### 5.5 AI Research Brief

**Activated panel:** Launchpad `ai-research` panel

- 1-minute automated summary card (metrics, news, earnings, consensus)
- Anomaly flags (volume spikes, options activity, insider trades)
- Peer divergence alerts
- All rule-based (no LLM dependency)

### 5.6 Community Layer

**New page:** `/equity/community`

- Published screens (enhance existing PublicScreens)
- Published chart templates
- Trade Ideas Feed (Symbol + Direction + Chart + Text)
- Paper Trading Leaderboard

**New files:**
- `frontend/src/pages/Community.tsx`
- `backend/api/routes/community.py`
- `backend/models/community.py`

---

## 9. Forge Task Matrix

### SWARM 1: Navigation & Interface Overhaul

| Task ID | Title | Agent | Depends | Key Files |
|---------|-------|-------|---------|-----------|
| S1-01-IMPL | GO-Bar: Recent securities + inline preview | Codex | — | CommandBar.tsx, TopBar.tsx, settingsStore.ts, useRecentSecurities.ts (new) |
| S1-01-QC | QC: GO-Bar enhancement | Gemini | S1-01-IMPL | .forge/results/S1-01-QC/* |
| S1-02-IMPL | GO-Bar: Sub-function routing + disambiguation | Codex | S1-01 | commanding.ts, CommandPalette.tsx, CommandBar.tsx |
| S1-02-QC | QC: Sub-function routing | Gemini | S1-02-IMPL | .forge/results/S1-02-QC/* |
| S1-03-IMPL | Symbol Context Menu (shared component) | Codex | — | SymbolContextMenu.tsx (new), integration in tables/lists |
| S1-03-QC | QC: Context menu | Gemini | S1-03-IMPL | .forge/results/S1-03-QC/* |
| S1-04-IMPL | Symbol Linking (color-coded groups) | Codex | — | SymbolLinkContext.tsx (new), PanelChrome.tsx, chartWorkstationStore.ts |
| S1-04-QC | QC: Symbol linking | Gemini | S1-04-IMPL | .forge/results/S1-04-QC/* |
| S1-05-IMPL | Hotlists page + backend | Codex | — | Hotlists.tsx (new), hotlists.py (new), hotlist_service.py (new), Sidebar.tsx, App.tsx |
| S1-05-QC | QC: Hotlists | Gemini | S1-05-IMPL | .forge/results/S1-05-QC/* |
| S1-06-IMPL | Multi-monitor tear-off + BroadcastChannel | Codex | S1-04 | PanelChrome.tsx, LaunchpadPopout.tsx, SymbolLinkContext.tsx |
| S1-06-QC | QC: Multi-monitor | Gemini | S1-06-IMPL | .forge/results/S1-06-QC/* |
| S1-07-IMPL | Navigation history + breadcrumbs + Alt+Left | Codex | — | useNavigationHistory.ts (new), navigationStore.ts (new), TopBar.tsx, CommandPalette.tsx |
| S1-07-QC | QC: Navigation history | Gemini | S1-07-IMPL | .forge/results/S1-07-QC/* |
| S1-08-QC | Swarm 1 integration QC + regression | Gemini | S1-01..S1-07 | Full E2E suite, .forge/results/S1-QC/* |

### SWARM 2: Multi-Asset Expansion

| Task ID | Title | Agent | Depends | Key Files |
|---------|-------|-------|---------|-----------|
| S2-01-IMPL | Commodities: backend service + routes | Codex | — | commodities.py (new), commodity_service.py (new), test_commodities.py (new) |
| S2-01-QC | QC: Commodities backend | Gemini | S2-01-IMPL | .forge/results/S2-01-QC/* |
| S2-02-IMPL | Commodities: frontend page + charts | Codex | S2-01 | Commodities.tsx (new), App.tsx, Sidebar.tsx, commanding.ts |
| S2-02-QC | QC: Commodities frontend | Gemini | S2-02-IMPL | .forge/results/S2-02-QC/* |
| S2-03-IMPL | Forex: backend service + routes | Codex | — | forex.py (new), forex_service.py (new), test_forex.py (new) |
| S2-03-QC | QC: Forex backend | Gemini | S2-03-IMPL | .forge/results/S2-03-QC/* |
| S2-04-IMPL | Forex: frontend page + matrix + heatmap | Codex | S2-03 | Forex.tsx (new), CrossRatesMatrix.tsx (new), CentralBankMonitor.tsx (new), App.tsx |
| S2-04-QC | QC: Forex frontend | Gemini | S2-04-IMPL | .forge/results/S2-04-QC/* |
| S2-05-IMPL | ETF Analytics: backend + frontend | Codex | — | etf.py (new), etf_service.py (new), ETFAnalytics.tsx (new), HoldingsViewer.tsx (new), OverlapAnalysis.tsx (new), FlowTracker.tsx (new), test_etf.py (new) |
| S2-05-QC | QC: ETF Analytics | Gemini | S2-05-IMPL | .forge/results/S2-05-QC/* |
| S2-06-IMPL | Mutual Fund enhancement + Bond screener | Codex | — | MutualFunds.tsx (extend), Bonds.tsx (new), bonds.py (new), bond_service.py (new), mutual_funds.py (extend) |
| S2-06-QC | QC: MF + Bonds | Gemini | S2-06-IMPL | .forge/results/S2-06-QC/* |
| S2-07-QC | Swarm 2 integration QC + regression | Gemini | S2-01..S2-06 | Full test suite, .forge/results/S2-QC/* |

### SWARM 3: Pro Analytics

| Task ID | Title | Agent | Depends | Key Files |
|---------|-------|-------|---------|-----------|
| S3-01-IMPL | Market Depth: backend (REST + WS depth) | Codex | — | depth.py (new), orderbook_service.py (new), stream.py (extend), test_depth.py (new) |
| S3-01-QC | QC: Market Depth backend | Gemini | S3-01-IMPL | .forge/results/S3-01-QC/* |
| S3-02-IMPL | Market Depth: frontend (ladder, depth chart, T&S) | Codex | S3-01 | OrderBookPanel.tsx (new), DepthChart.tsx (new), TimeSalesTape.tsx (new), StockDetail.tsx, LaunchpadPanels.tsx |
| S3-02-QC | QC: Market Depth frontend | Gemini | S3-02-IMPL | .forge/results/S3-02-QC/* |
| S3-03-IMPL | Attribution + Factor Decomposition: backend + frontend | Codex | — | portfolio_analytics.py (extend), portfolio.py (extend), AttributionPanel.tsx (new), FactorAttributionChart.tsx (new), Portfolio.tsx, test_attribution.py (new) |
| S3-03-QC | QC: Attribution | Gemini | S3-03-IMPL | .forge/results/S3-03-QC/* |
| S3-04-IMPL | Stress Testing: backend + frontend | Codex | — | stress_test_service.py (new), risk.py (extend), StressTestPanel.tsx (new), ScenarioBuilder.tsx (new), RiskDashboard.tsx, test_stress.py (new) |
| S3-04-QC | QC: Stress Testing | Gemini | S3-04-IMPL | .forge/results/S3-04-QC/* |
| S3-05-IMPL | TCA Frontend + Custom Ratios + Peer Enhancement | Codex | — | TCA.tsx (new), ShortfallWaterfall.tsx (new), CostDecomposition.tsx (new), tca.py (new), CustomRatioBuilder.tsx (new), custom_ratios.py (new), custom_ratio.py (new), PeersComparison.tsx (enhance), peers.py (extend), fields.py (extend) |
| S3-05-QC | QC: TCA + Ratios + Peers | Gemini | S3-05-IMPL | .forge/results/S3-05-QC/* |
| S3-06-QC | Swarm 3 integration QC + regression | Gemini | S3-01..S3-05 | Full test suite, .forge/results/S3-QC/* |

### SWARM 4: Charting UX + Intelligence Layer

| Task ID | Title | Agent | Depends | Key Files |
|---------|-------|-------|---------|-----------|
| S4-01-IMPL | OpenScript: backend compiler + script CRUD | Codex | — | scripting.py (extend), openscript_compiler.py (new), user_script.py (new), test_openscript.py (new) |
| S4-01-QC | QC: OpenScript backend | Gemini | S4-01-IMPL | .forge/results/S4-01-QC/* |
| S4-02-IMPL | OpenScript: frontend Monaco editor + live preview | Codex | S4-01 | ScriptEditor.tsx (new), ScriptLibrary.tsx (new), ChartWorkstationPage.tsx |
| S4-02-QC | QC: OpenScript frontend | Gemini | S4-02-IMPL | .forge/results/S4-02-QC/* |
| S4-03-IMPL | Pattern Recognition: backend + chart overlay | Codex | — | pattern_recognition_service.py (new), patterns.py (new), patternOverlay.ts (new), ChartToolbar.tsx, test_patterns.py (new) |
| S4-03-QC | QC: Pattern Recognition | Gemini | S4-03-IMPL | .forge/results/S4-03-QC/* |
| S4-04-IMPL | Drawing alerts + Anchored VWAP + Footprint | Codex | — | drawingEngine.ts (extend), DrawingTools.tsx, anchoredVwap.ts (new), alerts/service.py (extend), footprint_aggregator.py (new), footprintRenderer.ts (new), chart.py (extend), ChartEngine.tsx, test_footprint.py (new) |
| S4-04-QC | QC: Drawing alerts + AVWAP + Footprint | Gemini | S4-04-IMPL | .forge/results/S4-04-QC/* |
| S4-05-IMPL | 8-symbol overlay + Templates + Search preview | Codex | — | comparison.ts (extend), TemplateManager.tsx (new), TopBar.tsx (preview card), chart.py (seed templates) |
| S4-05-QC | QC: Overlay + Templates + Preview | Gemini | S4-05-IMPL | .forge/results/S4-05-QC/* |
| S4-06-IMPL | Event markers on chart + ESG backend/frontend | Codex | — | eventMarkerPlugin.ts (new), ChartToolbar.tsx, economics.py (extend), esg.py (new), esg_service.py (new), SecurityHub.tsx, test_esg.py (new) |
| S4-06-QC | QC: Events + ESG | Gemini | S4-06-IMPL | .forge/results/S4-06-QC/* |
| S4-07-IMPL | Fund Flows + Industry Analysis + AI Brief | Codex | — | flows.py (new), flow_ingestor.py (new), industry.py (new), ai.py (extend), SecurityHub.tsx, Dashboard.tsx, LaunchpadPanels.tsx, test_flows.py (new) |
| S4-07-QC | QC: Flows + Industry + AI | Gemini | S4-07-IMPL | .forge/results/S4-07-QC/* |
| S4-08-IMPL | Community layer (ideas, templates, leaderboard) | Codex | — | Community.tsx (new), community.py (new), community.py model (new), App.tsx |
| S4-08-QC | QC: Community | Gemini | S4-08-IMPL | .forge/results/S4-08-QC/* |
| S4-09-QC | Swarm 4 integration QC + regression | Gemini | S4-01..S4-08 | Full test suite + chart regression, .forge/results/S4-QC/* |

---

## 10. Swarm Topology & Execution Plan

### Phase 1 — Backend Foundation (All Parallel)

| Lane | Agent | Task | Focus |
|------|-------|------|-------|
| C1 | Codex | S1-01-IMPL | GO-Bar recent securities |
| C2 | Codex | S1-03-IMPL | Symbol Context Menu (shared) |
| C3 | Codex | S2-01-IMPL | Commodities backend |
| C4 | Codex | S2-03-IMPL | Forex backend |
| C5 | Codex | S3-01-IMPL | Market Depth backend |
| C6 | Codex | S3-03-IMPL | Attribution backend |
| C7 | Codex | S4-01-IMPL | OpenScript compiler |
| C8 | Codex | S4-03-IMPL | Pattern Recognition |

### Phase 2 — Frontend + Remaining Backend (Cascaded)

As Phase 1 tasks complete, their dependent frontend tasks start:
- S2-01 done → S2-02 (Commodities FE) starts
- S3-01 done → S3-02 (Depth FE) starts
- S4-01 done → S4-02 (OpenScript FE) starts

Independent tasks launch in parallel:
- S1-04 (Symbol Linking), S1-05 (Hotlists), S1-07 (Nav History)
- S2-05 (ETF), S2-06 (MF + Bonds)
- S3-04 (Stress Test), S3-05 (TCA + Ratios)
- S4-04 (Drawings + AVWAP + Footprint), S4-05 (Overlay + Templates)
- S4-06 (Events + ESG), S4-07 (Flows + Industry), S4-08 (Community)

### Phase 3 — QC Sweep

Gemini QC runs per-task as each IMPL completes, then per-swarm integration QC:
- S1-08-QC (Navigation integration)
- S2-07-QC (Multi-asset integration)
- S3-06-QC (Analytics integration)
- S4-09-QC (Charting + Intelligence integration)

### Phase 4 — Cross-Swarm Final QC

Final full regression: all 4 swarms verified together, full test suite, E2E on all smoke paths.

---

## 11. Regression & QC Gates

### Per-Task Gate (Every IMPL)

```bash
# Backend
pytest backend/tests/ -x -q                    # 0 failures

# Frontend
cd frontend && npm run build                     # 0 TS/build errors
cd frontend && npm test                          # 0 Vitest failures
cd frontend && npm run test:e2e                  # 0 Playwright failures
```

### Per-Swarm Integration Gate (Gemini)

- All existing pages render without error
- All existing keyboard shortcuts still work
- All existing WebSocket flows still connect
- All existing chart functionality preserved (indicators, drawings, replay, crosshair sync)
- All existing screener expressions still evaluate correctly
- All existing portfolio/risk/OMS pages still functional
- New features meet acceptance criteria
- Evidence artifacts captured under `.forge/results/`

### Evidence Artifacts (Per Task)

```
.forge/results/{TASK-ID}/
├── commands.txt          # Exact CLI commands executed
├── pytest.txt            # Backend test output
├── frontend-test.txt     # Vitest output
├── frontend-build.txt    # Build log
├── playwright.txt        # E2E results (if UI-scoped)
├── findings.md           # QC findings by severity
├── qc-checklist.md       # Pass/fail per acceptance criterion
├── perf.json             # Latency metrics
└── notes.md              # Blockers, workarounds, accepted risk
```

---

## 12. File Lock Domains

### Swarm 1 (Navigation)
```
frontend/src/components/layout/CommandBar.tsx
frontend/src/components/layout/CommandPalette.tsx
frontend/src/components/layout/commanding.ts
frontend/src/components/layout/TopBar.tsx
frontend/src/components/layout/PanelChrome.tsx
frontend/src/components/layout/Sidebar.tsx
frontend/src/components/layout/LaunchpadPopout.tsx (S1 only after S1-06)
frontend/src/components/common/SymbolContextMenu.tsx (new)
frontend/src/contexts/SymbolLinkContext.tsx (new)
frontend/src/store/settingsStore.ts
frontend/src/store/navigationStore.ts (new)
frontend/src/hooks/useRecentSecurities.ts (new)
frontend/src/hooks/useNavigationHistory.ts (new)
frontend/src/pages/Hotlists.tsx (new)
backend/api/routes/hotlists.py (new)
backend/services/hotlist_service.py (new)
```

### Swarm 2 (Multi-Asset)
```
frontend/src/pages/Commodities.tsx (new)
frontend/src/pages/Forex.tsx (new)
frontend/src/pages/ETFAnalytics.tsx (new)
frontend/src/pages/Bonds.tsx (new)
frontend/src/pages/MutualFunds.tsx
frontend/src/components/forex/* (new)
frontend/src/components/etf/* (new)
frontend/src/components/mutualFunds/*
backend/api/routes/commodities.py (new)
backend/api/routes/forex.py (new)
backend/api/routes/etf.py (new)
backend/api/routes/bonds.py (new)
backend/api/routes/mutual_funds.py
backend/services/commodity_service.py (new)
backend/services/forex_service.py (new)
backend/services/etf_service.py (new)
backend/services/bond_service.py (new)
```

### Swarm 3 (Pro Analytics)
```
frontend/src/components/market/OrderBookPanel.tsx (new)
frontend/src/components/market/DepthChart.tsx (new)
frontend/src/components/market/TimeSalesTape.tsx (new)
frontend/src/components/portfolio/AttributionPanel.tsx (new)
frontend/src/components/portfolio/FactorAttributionChart.tsx (new)
frontend/src/components/risk/StressTestPanel.tsx (new)
frontend/src/components/risk/ScenarioBuilder.tsx (new)
frontend/src/components/tca/* (new)
frontend/src/components/analysis/CustomRatioBuilder.tsx (new)
frontend/src/components/analysis/PeersComparison.tsx
frontend/src/pages/TCA.tsx (new)
frontend/src/pages/Portfolio.tsx
frontend/src/pages/RiskDashboard.tsx
frontend/src/pages/StockDetail.tsx
backend/api/routes/depth.py (new)
backend/api/routes/tca.py (new)
backend/api/routes/custom_ratios.py (new)
backend/services/orderbook_service.py (new)
backend/services/portfolio_analytics.py
backend/services/stress_test_service.py (new)
backend/models/custom_ratio.py (new)
backend/api/routes/risk.py
backend/api/routes/portfolio.py
backend/api/routes/peers.py
backend/screener/fields.py
```

### Swarm 4 (Charting + Intelligence)
```
frontend/src/shared/chart/drawingEngine.ts
frontend/src/shared/chart/comparison.ts
frontend/src/shared/chart/ChartEngine.tsx
frontend/src/shared/chart/anchoredVwap.ts (new)
frontend/src/shared/chart/footprintRenderer.ts (new)
frontend/src/shared/chart/patternOverlay.ts (new)
frontend/src/shared/chart/eventMarkerPlugin.ts (new)
frontend/src/components/chart/ScriptEditor.tsx (new)
frontend/src/components/chart/ScriptLibrary.tsx (new)
frontend/src/components/chart/ChartToolbar.tsx
frontend/src/components/chart/DrawingTools.tsx
frontend/src/components/chart-workstation/TemplateManager.tsx (new)
frontend/src/pages/ChartWorkstationPage.tsx
frontend/src/pages/SecurityHub.tsx
frontend/src/pages/Dashboard.tsx
frontend/src/pages/Community.tsx (new)
frontend/src/components/layout/LaunchpadPanels.tsx
backend/api/routes/scripting.py
backend/api/routes/patterns.py (new)
backend/api/routes/chart.py
backend/api/routes/esg.py (new)
backend/api/routes/flows.py (new)
backend/api/routes/industry.py (new)
backend/api/routes/ai.py
backend/api/routes/community.py (new)
backend/api/routes/economics.py
backend/services/openscript_compiler.py (new)
backend/services/pattern_recognition_service.py (new)
backend/services/footprint_aggregator.py (new)
backend/services/esg_service.py (new)
backend/services/flow_ingestor.py (new)
backend/models/user_script.py (new)
backend/models/community.py (new)
backend/alerts/service.py
```

### Shared Files (Cross-Swarm — Sequential Access)

```
frontend/src/App.tsx           — S1-05, S2-02, S2-04, S2-05, S2-06, S3-06, S4-09
frontend/src/components/layout/Sidebar.tsx — S1-05, S2-02, S2-04, S2-05, S2-06
```

These shared files are modified by multiple swarms (adding routes/nav items). Codex agents must add only their own entries and not touch other sections. Gemini QC verifies no cross-swarm collision in shared files.

---

## 13. Data Provider Strategy

| Feature | Primary Source | Fallback | Free Tier Limits |
|---------|---------------|----------|------------------|
| Commodities | Yahoo Finance (`GC=F`, `CL=F`) | FMP | yfinance: ~2K/day |
| Forex | Yahoo Finance (`EURUSD=X`) | Finnhub | Finnhub: 60/min |
| ETF Holdings | FMP | Yahoo Finance | FMP: 250/day |
| ETF Flows | FMP | N/A | FMP: 250/day |
| Bond Data | FRED API (US), RBI (India) | N/A | FRED: unlimited |
| Market Depth | Kite (India), Finnhub (US), Binance (Crypto) | N/A | Kite: 3/s, Finnhub: 50 sym |
| ESG Scores | Yahoo Finance sustainability | FMP | yfinance: ~2K/day |
| FII/DII Flows | NSEPython scraper | N/A | Unofficial, no SLA |
| Pattern Detection | Computed from OHLCV (no provider) | N/A | N/A |
| Footprint | Kite ticks (India), Finnhub ticks (US) | N/A | Same as quotes |

---

## 14. Risk Register

| Risk | Impact | Probability | Mitigation |
|------|--------|------------|------------|
| FMP free tier exhaustion (250/day) | ETF/ESG data unavailable | Medium | Cache aggressively (24hr TTL), batch requests, queue with backoff |
| Finnhub 50-symbol WS limit | US depth data limited | High | Prioritize active symbols, rotate subscriptions, document limit |
| OpenScript injection attacks | Security breach | Low | AST whitelist (proven pattern from screener), fuzz testing in QC |
| Chart Engine regression from new series types | Existing charts break | Medium | All new chart types are additive (new series, not modifying existing), full E2E regression |
| Shared file conflicts (App.tsx, Sidebar.tsx) | Merge conflicts across swarms | Medium | Sequential access policy, each swarm adds only its own entries |
| yfinance scraping blocked | Commodity/Forex data unavailable | Low | FMP fallback, cache layer absorbs temporary outages |
| Cross-window BroadcastChannel support | Multi-monitor fails on old browsers | Low | Feature-detect, graceful fallback to single-window |
| Footprint chart performance (tick-level rendering) | UI freeze on high-volume symbols | Medium | Canvas-based renderer, configurable aggregation granularity, max 500 price levels |

---

## Appendix: New Command Codes

Add to `commanding.ts`:

| Code | Label | Route | Aliases |
|------|-------|-------|---------|
| CMDTY | Commodities | /equity/commodities | COMMODITY, GOLD, OIL |
| FX | Forex | /equity/forex | FOREX, CURRENCY |
| ETFA | ETF Analytics | /equity/etf | ETF |
| BOND | Bonds | /equity/bonds | CREDIT, FIXED |
| HOT | Hotlists | /equity/hotlists | MOVERS, GAINERS, LOSERS |
| TCA | Transaction Costs | /equity/tca | COST, SLIPPAGE |
| COMM | Community | /equity/community | IDEAS, SOCIAL |
| DEPTH | Market Depth | (panel toggle) | DOM, L2, BOOK |

---

*End of specification.*
