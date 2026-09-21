# Screenshot manifest (captured 2026-09-21, built app served by uvicorn, viewport 1680×1050 @2×)

Every screen loaded with **zero failed API calls and zero page errors** except where noted. Account-backed screens were seeded via the API before capture.

## Mission Control & Navigation

| File | Route | Description | Load | Notes |
|---|---|---|---|---|
| `home.png` | `/home` | Mission Control dashboard | 11.7s · ok |  |
| `launchpad.png` | `/equity/launchpad` | Launchpad workspace | 26.8s · ok |  |
| `market-dashboard.png` | `/equity/dashboard` | Market dashboard | 3.6s · ok |  |
| `account.png` | `/account` | Account settings and profile | 3.4s · ok |  |

## Equity Research & Markets

| File | Route | Description | Load | Notes |
|---|---|---|---|---|
| `market-view.png` | `/equity/stocks?ticker=AAPL` | AAPL market chart view | 7.7s · ok |  |
| `stock-detail.png` | `/equity/security/AAPL?tab=overview` | AAPL Security Hub | 15.0s · 404 /api/stock-picking/conviction/AAPL | Conviction feed reports 'unavailable' until catalyst notes are ingested (expected, not an error). |
| `security-hub-india.png` | `/equity/security/RELIANCE?tab=overview` | RELIANCE Security Hub | 15.9s · 404 /api/stock-picking/conviction/RELIANCE | Same as above. Context Rail open to show quote/position/alerts/events/actions. |
| `financial-analysis.png` | `/equity/security/RELIANCE?tab=financials` | Financial statement analysis | 4.5s · ok |  |
| `chart-workstation.png` | `/equity/chart-workstation` | Six-pane chart workstation | 4.1s · ok |  |
| `multi-timeframe.png` | `/equity/mta` | Multi-timeframe analysis | 19.7s · ok |  |
| `dom.png` | `/equity/dom` | Depth of market view | 5.5s · ok | Order book is SYNTHETIC (labelled) and centred on the real last price; tape is real. |
| `time-and-sales.png` | `/equity/tape` | Time and sales tape | 5.4s · ok |  |
| `split-compare.png` | `/equity/compare?symbols=AAPL,MSFT` | Multi-symbol split comparison | 24.3s · ok |  |
| `market-heatmap.png` | `/equity/heatmap` | Market heatmap | 4.5s · ok |  |
| `hotlists.png` | `/equity/hotlists` | Hotlists | 3.6s · ok |  |
| `watchlist.png` | `/equity/watchlist` | Populated watchlist | 13.0s · ok | Seeded 'Core Ideas' (8 symbols). |
| `screener.png` | `/equity/screener` | Advanced screener after running a scan | 25.4s · ok |  |
| `factor-dashboard.png` | `/equity/factors` | Factor dashboard | 4.1s · ok |  |
| `relative-strength.png` | `/equity/rs` | Relative strength dashboard | 3.3s · ok |  |
| `sector-rotation.png` | `/equity/sector-rotation` | Sector rotation dashboard | 3.5s · ok |  |
| `dividends.png` | `/equity/dividends` | Dividend dashboard | 3.7s · ok | Sparse on this machine for the same reason. |
| `insider-activity.png` | `/equity/insider` | Insider activity monitor | 3.4s · ok |  |
| `earnings-calendar.png` | `/equity/earnings` | Earnings calendar | 3.2s · ok | Empty on this machine: FMP earnings calendar / NSE not reachable from here. |

## Portfolio, Risk & Trading

| File | Route | Description | Load | Notes |
|---|---|---|---|---|
| `portfolio.png` | `/equity/portfolio` | Populated portfolio with holdings and risk metrics | 38.0s · ok | Seeded 6 holdings (5 NSE + AAPL). |
| `portfolio-lab.png` | `/equity/portfolio/lab` | Portfolio Lab | 3.5s · ok |  |
| `risk-dashboard.png` | `/equity/risk` | Risk dashboard | 5.0s · ok |  |
| `correlation-dashboard.png` | `/equity/correlation` | Correlation matrix dashboard | 3.8s · ok |  |
| `cockpit.png` | `/equity/cockpit` | Cockpit priority stack | 9.1s · ok |  |
| `paper-trading.png` | `/equity/paper` | Populated paper trading workspace | 3.9s · ok | Seeded 'Momentum Book' with a filled RELIANCE market order and a pending AAPL limit. |
| `position-sizer.png` | `/equity/position-sizer` | Position sizing calculator | 3.6s · ok |  |
| `trade-journal.png` | `/equity/journal` | Trade journal | 3.4s · ok | Seeded two closed trades. |
| `shadow-account.png` | `/equity/shadow-account` | Shadow account behavioural analytics | 3.5s · ok |  |
| `alerts.png` | `/equity/alerts` | Alerts console and alert builder | 3.4s · ok | Seeded two rules, one with an add-to-watchlist action. |
| `portfolio-optimizer.png` | `/backtesting/portfolio-optimizer` | Portfolio optimizer | 29.5s · ok |  |

## Quant Research & Backtesting

| File | Route | Description | Load | Notes |
|---|---|---|---|---|
| `research-autopilot.png` | `/equity/research-autopilot` | Research Autopilot | 3.3s · ok |  |
| `model-lab.png` | `/backtesting/model-lab` | Model Lab | 3.5s · ok |  |
| `model-governance.png` | `/backtesting/model-governance` | Model governance | 3.5s · ok |  |
| `pair-trading.png` | `/equity/pair-trading` | Pair Trading Lab | 7.5s · ok |  |
| `alpha-zoo.png` | `/equity/alpha-zoo` | Alpha Zoo factor library | 70.3s · ok |  |
| `strategy-export.png` | `/equity/strategy-export` | Strategy export (Pine / MQL5) | 12.9s · ok |  |
| `algorithm-framework.png` | `/backtesting/algorithm-framework` | Algorithm framework lab | 44.8s · ok |  |
| `stat-lab.png` | `/equity/stat-lab` | Statistical Lab | 29.7s · ok |  |
| `backtesting.png` | `/backtesting` | Backtesting workspace | 49.6s · ok |  |

## Futures & Options

| File | Route | Description | Load | Notes |
|---|---|---|---|---|
| `fno-option-chain.png` | `/fno?symbol=AAPL` | F&O option chain | 7.2s · ok | Captured on AAPL (US options via Yahoo); NSE F&O is blocked from this machine. |
| `fno-greeks.png` | `/fno/greeks?symbol=AAPL` | F&O Greeks | 5.1s · ok |  |
| `fno-futures.png` | `/fno/futures?symbol=AAPL` | Futures analytics | 6.3s · ok |  |
| `fno-oi.png` | `/fno/oi?symbol=AAPL` | Open interest analysis | 5.9s · ok |  |
| `fno-strategy.png` | `/fno/strategy?symbol=AAPL` | Options strategy builder | 3.4s · ok |  |
| `fno-pcr.png` | `/fno/pcr?symbol=AAPL` | Put-call ratio dashboard | 5.1s · ok |  |
| `fno-flow.png` | `/fno/flow?symbol=AAPL` | Options flow dashboard | 20.8s · ok |  |
| `fno-heatmap.png` | `/fno/heatmap?symbol=AAPL` | F&O heatmap | 24.2s · ok |  |
| `fno-expiry.png` | `/fno/expiry?symbol=AAPL` | F&O expiry calendar | 24.2s · ok |  |
| `option-greeks-calculator.png` | `/equity/option-greeks` | Option Greeks calculator | 10.8s · ok |  |

## Cross-Asset & Macro

| File | Route | Description | Load | Notes |
|---|---|---|---|---|
| `commodities.png` | `/equity/commodities` | Commodities workspace | 3.3s · ok |  |
| `forex.png` | `/equity/forex` | Forex workspace | 3.8s · ok |  |
| `crypto.png` | `/equity/crypto` | Crypto workspace | 5.2s · ok |  |
| `etf-analytics.png` | `/equity/etf-analytics` | ETF analytics | 4.6s · ok |  |
| `mutual-funds.png` | `/equity/mutual-funds` | Mutual funds workspace | 3.3s · ok |  |
| `bonds.png` | `/equity/bonds` | Bonds workspace | 3.2s · ok |  |
| `yield-curve.png` | `/equity/yield-curve` | Yield curve dashboard | 3.4s · ok |  |
| `economic-terminal.png` | `/equity/economics` | Economic terminal | 3.7s · ok |  |
| `data-quality.png` | `/equity/data-quality` | Data quality dashboard | 3.3s · ok | All counters zero: no data-quality jobs have run locally. |
| `bond-analytics.png` | `/equity/bond-analytics` | Bond analytics calculator | 11.1s · ok |  |

## Intelligence, AI & Platform

| File | Route | Description | Load | Notes |
|---|---|---|---|---|
| `news-sentiment.png` | `/equity/news?ticker=AAPL` | News and sentiment | 11.1s · ok |  |
| `intelligence-timeline.png` | `/equity/intelligence-timeline` | Intelligence timeline | 4.8s · ok |  |
| `research.png` | `/equity/research` | Research library | 3.4s · ok | Empty knowledge base (nothing ingested). |
| `oms-compliance.png` | `/equity/oms` | OMS compliance dashboard | 3.2s · ok | No OMS orders seeded. |
| `ops-dashboard.png` | `/equity/ops` | Operations dashboard | 3.1s · ok |  |
| `plugins.png` | `/equity/plugins` | Plugin manager | 3.3s · ok |  |
| `settings.png` | `/equity/settings` | Settings with Data Providers | 3.4s · ok |  |
| `saved-views.png` | `/equity/saved-views` | Saved views manager | 3.2s · ok | No saved views seeded. |
| `reports.png` | `/reports` | Scheduled reports | 2.2s · ok | Renders outside the terminal shell (route is not nested under a layout) — cosmetic inconsistency, not fixed here. |

## Bugs found and fixed during this sweep

- 54 screens called `GET /api/watchlist` (404) — added the singular alias to the legacy holdings watchlist endpoint.
- News / sentiment / crypto-movers / 2s10s / healthz / backtest-jobs calls used paths that never existed on the backend — repointed all of them.
- 17 components used raw `fetch()` without the bearer token (charts, depth, layouts, scripting, ETF, bonds via bare axios) — installed a global authenticated-fetch shim and moved Bonds onto the shared client.
- Scheduled Reports had a scheduler service but no routes — mounted `GET/POST/DELETE /api/reports/scheduled`.
- `POST /api/watchlists` silently dropped the `symbols` in the payload.
- `/api/chart/<US symbol>?market=NSE` returned 0 bars — now retries without the market hint.
- The order-book service is entirely synthetic but labelled itself `kite`/`finnhub`; the HotKey panel priced orders off it (RELIANCE at 6,096). Now labelled SYNTHETIC, never used as a price basis, and centred on the real last price.
- `/reports` served the marketing landing page instead of the app.
- Backtesting result rendering crashed on `removeSeries` after a chart reset, and the 3D panels crashed the whole page without WebGL.
