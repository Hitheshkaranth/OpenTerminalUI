# Paper Trading Regression Guardrail

Goal: keep paper trading simple (basic buy/sell holdings + watchlist) and decoupled from the new backtesting pipeline.

## Checklist

- Portfolio endpoints remain unchanged:
  - `POST /api/portfolio/holdings`
  - `DELETE /api/portfolio/holdings/{holding_id}`
  - `GET /api/portfolio`
- Backtesting endpoints are isolated under:
  - `POST /api/backtests`
  - `GET /api/backtests/{run_id}/status`
  - `GET /api/backtests/{run_id}/result`
- No portfolio route imports or depends on backtesting job service.
- Paper trading flows continue to use existing `Holding` and `WatchlistItem` models only.

## Verification

Run:

```bash
cd backend && source .venv/bin/activate && python -m compileall . && pytest -q
```
