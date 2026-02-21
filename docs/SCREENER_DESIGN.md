# Screener Design (Technical Scanner + Alerts)

## Module map
- `backend/scanner_engine/indicators.py`: deterministic indicator pack (EMA/RSI/MACD/ATR/BB/Keltner/Donchian/Supertrend/RVOL/ROC).
- `backend/scanner_engine/detectors.py`: pure detector functions returning `passed/setup_type/levels/features/explain_steps`.
- `backend/scanner_engine/ranking.py`: stable scoring + deterministic ordering.
- `backend/scanner_engine/runner.py`: universe resolution, OHLCV fetch/cache, liquidity gate, detector execution.
- `backend/screener/persistence.py`: presets/run/result/scanner-rule persistence + default preset pack bootstrap.
- `backend/screener/routes.py`: `/api/v1/screener/*` + `/api/v1/alerts/scanner-rules`.
- `backend/alerts/scanner_rules.py`: scanner alert near/trigger/invalidation + dedupe logic.
- `backend/alerts/service.py`: existing alert worker extended to evaluate scanner rules and emit scanner events.

## DB schema
- `scan_presets`
  - `id, user_id, name, universe, timeframe`
  - `liquidity_gate_json, rules_json, ranking_json`
  - `created_at, updated_at`
- `scan_runs`
  - `id, user_id, preset_id`
  - `started_at, finished_at, status`
  - `meta_json, summary_json`
- `scan_results`
  - `id, run_id, symbol, setup_type, score, signal_ts`
  - `levels_json, features_json, explain_json`
- `scan_alert_rules`
  - `id, user_id, preset_id, symbol, setup_type`
  - `trigger_level, invalidation_level, near_trigger_pct`
  - `dedupe_minutes, enabled, last_event_type, last_event_at`
  - `meta_json, created_at, updated_at`

## Endpoint spec
- Presets
  - `GET /api/v1/screener/presets`
  - `POST /api/v1/screener/presets`
  - `PUT /api/v1/screener/presets/{id}`
  - `DELETE /api/v1/screener/presets/{id}`
- Runs
  - `POST /api/v1/screener/run` (`preset_id` or `inline_preset`)
  - `GET /api/v1/screener/runs?limit=&offset=`
  - `GET /api/v1/screener/results?run_id=&limit=&offset=`
- Scanner alerts
  - `POST /api/v1/alerts/scanner-rules`
  - `GET /api/v1/alerts/scanner-rules`

## WS payload
- Existing channel reused: `/api/ws/alerts`
- Scanner payload shape:
```json
{
  "type": "alert_triggered",
  "source": "scanner",
  "preset_id": "...",
  "symbol": "NSE:RELIANCE",
  "event_type": "near_trigger|triggered|invalidation",
  "payload": {
    "trigger_level": 2450.5,
    "invalidation_level": 2380.0,
    "distance_to_trigger": 0.002
  }
}
```

## Performance plan
- Per-run OHLCV fetch cache keyed by `(symbol,timeframe)`.
- Single indicator pack compute per symbol (no repeated detector recomputation).
- Liquidity gate before detector fan-out.
- Result pagination via `limit/offset` on API and DB query.
- Stable deterministic ranking: score descending, then symbol ascending.
