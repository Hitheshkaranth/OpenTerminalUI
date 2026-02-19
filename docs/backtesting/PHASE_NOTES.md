# Phase Notes

## Phase 0

- Added docs status tracker.
- Added dependency declarations for planned backend/frontend modules.
- Added versioned v1 adapter endpoints without breaking legacy routes.

## Phase 4A

- Extended backtest result model with institutional metrics.
- Added walk-forward, Monte Carlo simulation, and optimization modules.
- Exposed strategy presets API and analytics output.
- Added portfolio backtest engine, factor decomposition module, and data-store catalog endpoints.
- Added NSE F&O bhavcopy parser + table model scaffold.

## Phase 4B/4C/4D

- Frontend now includes richer backtesting tabs and strategy comparison.
- Added feature-flagged pro workspace shell (`VITE_BACKTEST_PRO_WORKSPACE=1`) with tiled layout, command palette (`Ctrl/Cmd+K`), and panel catalog.
