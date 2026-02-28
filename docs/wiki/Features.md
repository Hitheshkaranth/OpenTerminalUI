# Features

## Terminal Shell

- Command Bar (GO) with command parsing, fuzzy lookup, and keyboard shortcuts
- TickerTape for rolling market pulse
- MarketStatusBar with clock/status/connection telemetry
- Theme engine (Terminal Noir, classic, light, custom accent)

## Launchpad

- Multi-panel grid workspace
- Panel linking for shared symbol context and chart sync
- Layout presets + popout support

## Security Hub

- Tabbed DES-style ticker view
- Overview, Financials, Chart, News, Ownership, Estimates, Peers, ESG
- Lazy-loading tab data + dense rendering

## Charting

- Unified chart components for stock/workstation/comparison/security views
- Crosshair sync groups
- Volume profile overlay (VPOC + value area)
- Drawing persistence and template APIs
- Right-click quick action: Add to Portfolio

## Screener

- Multi-market scan (NSE/NYSE/NASDAQ)
- Presets + formula mode
- DenseTable-backed result grid
- Actions: Add to Watchlist / Add to Portfolio

## Portfolio

- Multi-portfolio CRUD
- Holdings + transactions
- Analytics endpoint with allocation, PnL, annualized return, Sharpe, max drawdown
- Manager UI with summary cards and tables

## News & Alerts

- Realtime/news ingestion services
- Sentiment labels and trend visualization
- Scanner alert rules + scheduler-backed evaluation

## Economics & Macro

- **Economic Calendar**: Month/week view of global events with impact coding and country filtering.
- **Macro Dashboard**: Cross-region tracking (US, India, EU, China) for GDP, CPI, unemployment, and rates.
- **Yield Curve**: Interactive US Treasury yield curve dashboard with historical overlays and inversion detection.

## AI & Research

- **AI Research Copilot**: NLQ engine supporting natural language questions for data lookup, comparisons, and chart commands.
- **Screener Integration**: AI-driven filter generation based on natural language queries.
- **Research Panel**: Persistent AI chat interface in the Launchpad.

## Sector Analysis

- **Sector Rotation (RRG)**: Visual Relative Rotation Graph implementation for tracking sector leadership cycles.
- **Trailing Paths**: Visual trails showing rotation momentum over the last 12 weeks.

## Advanced Data Handling

- **Redis Quote Bus**: Pub/Sub architecture for horizontally scalable realtime quote distribution.
- **Distributed Aggregation**: Shared 1-min bar construction role with Redis distributed locking.
- **Multi-Watchlist System**: Named watchlist management with dynamic **Heatmap** treemap mode.

## Backtesting

- **Intraday Backtesting**: High-resolution (1m, 5m, 1h) testing with session-aware logic.
- **Vectorized Engine**: Performance-first NumPy implementation for processing large historical datasets.

## Platform

- FastAPI backend + React/Vite frontend
- Docker compose deployment
- CI with backend + frontend + E2E checks
- **Redis Integration**: Required for quote distribution and bar aggregation.
