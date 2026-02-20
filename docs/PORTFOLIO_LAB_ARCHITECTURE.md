# Portfolio Lab Architecture Spec

## Domain
New backend domain: `backend/portfolio_lab/*`

## Core DTOs
- `PortfolioDefinition`
- `PortfolioBacktestRun`
- `PortfolioReport`
- `StrategyBlendDefinition`
- `WeightingMethod`: `EQUAL`, `VOL_TARGET`, `RISK_PARITY`

## Execution Model
Option 1 implemented: Portfolio Lab orchestrates per-asset/per-strategy backtests by calling shared backtest service directly (`backend/services/backtest_jobs.py`) rather than HTTP calls.

## Data Entities
- `portfolio_definitions`
- `strategy_blends`
- `portfolio_runs`
- `portfolio_run_metrics`
- `portfolio_run_timeseries`
- `portfolio_run_matrices`

## Canonical Report Schema
- `metrics`: cagr, sharpe, sortino, max_drawdown, vol_annual, calmar, turnover, alpha/beta when benchmark exists
- `series`: portfolio equity, benchmark equity, drawdown, underwater, exposure, leverage, returns, rolling metrics, turnover, contributions, monthly returns
- `tables`: latest weights, top contributors/detractors, worst drawdowns, rebalance log
- `matrices`: correlation matrix, labels, cluster order

## Construction Methods
- `EQUAL`: equal rebalance weights with cap normalization
- `VOL_TARGET`: inverse-vol weighting over rolling window
- `RISK_PARITY`: iterative risk-contribution equalization on regularized covariance

## Blending
- MVP mode: `WEIGHTED_SUM_RETURNS`
- Portfolio asset return = weighted blend of strategy return streams per asset

## Limits + Caching
- Max assets: 200
- Max blend strategies: 10
- Max lookback window: 10 years
- Report cache key: `portfolio-lab:report:{run_id}` using shared cache layer

## Frontend Routes
- `/portfolio-lab`
- `/portfolio-lab/portfolios/:id`
- `/portfolio-lab/runs/:runId`
- `/portfolio-lab/blends`

## Acceptance Plan
- Backend engine unit tests on synthetic returns
- Backend API route tests for create/list/run/report
- Frontend smoke tests for new pages
- Playwright E2E for create portfolio/run/report and create blend flow
