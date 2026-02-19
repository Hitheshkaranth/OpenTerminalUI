# Backtesting Blueprint Implementation Status

This folder tracks implementation of the "OpenTerminalUI Pro Backtesting Enhancement Blueprint v1.0".

## Milestones

- [x] M0: Build passes (backend + frontend), existing backtesting flow remains operational.
- [ ] M1: Phase 4A engine foundation complete.
- [ ] M2: Phase 4B visualization suite complete.
- [ ] M3: Phase 4C mosaic workspace complete.
- [ ] M4: Phase 4D advanced research modules complete.

## Progress Snapshot

- Added extended strategy catalog and comparison workflow.
- Added analytics endpoint for drawdown, rolling metrics, distribution, and trade diagnostics.
- Added v1 API compatibility endpoints under `/api/v1/backtest/*`.
- Added deterministic walk-forward, Monte Carlo, and parameter optimization backend modules.
- Added institutional metrics fields to backtest result schema and engine output.

## Compatibility Rules

- Legacy endpoints remain supported: `/api/backtests/*` and `/api/backtest/run`.
- New features are additive and versioned via `/api/v1/backtest/*`.
