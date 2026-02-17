# Group C QC Guideline (Events & Earnings)

## Quality Gates (Strict)

1. API Contract Gate
- Every new endpoint must return stable JSON envelope (`count/items` or `item`).
- Invalid query params must fail fast with HTTP 400.
- Route tests must cover success and validation failure paths.

2. Data Semantics Gate
- Event/Earnings collections must be date-sorted as specified.
- Portfolio aggregation must be parallelized with bounded concurrency (`Semaphore`).
- Dedupe behavior must not emit duplicate symbol-date records.

3. Resilience Gate
- External provider failure must degrade to empty/safe responses without 500.
- Missing API keys must not break endpoint contracts.

4. Frontend Utility Gate
- New components must compile under strict TS build.
- New data types/hooks must have no `any` leaks in component integration paths.
- Stock detail, portfolio, dashboard integrations must render with empty payloads.

5. Regression Gate
- Existing core endpoints remain reachable (HTTP 200 smoke checks).
- Backend module import (`backend.main`) must succeed.

## Execution Checklist (must pass before merge)

1. `python -m compileall backend`
2. `pytest -q backend/tests/test_events_routes_qc.py backend/tests/test_earnings_routes_qc.py backend/tests/test_earnings_service_qc.py`
3. `npm.cmd run build --prefix frontend`
4. Boot app and run endpoint smoke checks:
- `/api/events/...`
- `/api/earnings/...`
- Existing critical endpoints (`/api/stocks/search`, `/healthz`, etc.)

## Failure Policy
- Any failing gate blocks completion.
- Fix code, re-run full checklist, and only then report completion.
