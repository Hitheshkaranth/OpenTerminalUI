# Screener Upgrade Notes

## What shipped
- Added technical scanner engine with:
  - indicators: EMA 9/21/50/200, RSI14, MACD 12/26/9, ATR14/ATR%, BB20,2, Keltner20,1.5, Donchian20/55, RVOL20, ROC10/20, Supertrend.
  - detectors: N-day breakout, BB squeeze breakout, NR7 breakout, inside bar breakout, trend retest, supertrend+EMA stack.
  - explainability payload (`explain_steps`) for each detector.
- Added persistence for:
  - presets, runs, results, scanner alert rules.
- Added new v1 screener APIs:
  - `/api/v1/screener/presets`, `/api/v1/screener/run`, `/api/v1/screener/runs`, `/api/v1/screener/results`
  - `/api/v1/alerts/scanner-rules`
- Extended existing alert engine worker to evaluate scanner rules and emit on the existing websocket alerts stream.
- Updated frontend Screener page to support:
  - preset selection/edit/run
  - results table
  - explainability panel
  - scanner alert creation from selected setup
- Updated Alerts page/history to display scanner source + event type tabs (`Near`, `Triggered`, `Invalidated`).

## Compatibility
- Existing endpoints (`/api/screener/run`, `/api/screener/run-v2`, `/api/alerts`, `/api/ws/alerts`) remain unchanged.
- Scanner notifications are emitted as `type=alert_triggered` with additional fields (`source`, `event_type`, `payload`).

## Tests added
- Backend unit tests: detector behavior + deterministic output checks.
- Backend API tests: preset CRUD, run, results pagination, scanner rule create/list.
- Frontend e2e smoke: screener page render + run flow with mocked API.
