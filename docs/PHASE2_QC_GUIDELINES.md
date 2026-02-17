# Phase 2 Strict QC Guideline

## Scope Gate
- Changes must include:
  - Backend route coverage for `alerts`, `paper`, `chart-drawings`.
  - Auth protection for all new `/api/*` routes.
  - At least one backend test per new feature area.
  - Frontend build green after API/type updates.

## Hard Checks (must pass)
1. `python -m compileall backend`
2. `pytest -q backend/tests/test_phase2_core_expansion.py backend/tests/test_adapter_registry_phase2.py`
3. `pytest -q backend/tests/test_auth_endpoints.py` (regression guard)
4. `npm.cmd run build --prefix frontend`

## Docker Integration Check
1. `docker compose down`
2. `docker compose up -d --build`
3. `curl http://127.0.0.1:8000/healthz` returns `200`.
4. Auth flow:
   - Register user
   - Login user
5. API smoke:
   - `POST /api/alerts`
   - `GET /api/alerts`
   - `POST /api/paper/portfolios`
   - `POST /api/paper/orders`
   - `POST /api/chart-drawings/{symbol}`
6. WebSocket smoke:
   - `/api/ws/alerts` accepts connection and `ping` returns `pong`.

## Failure Policy
- If any hard check fails:
  - Stop adding features.
  - Fix failure first.
  - Re-run full hard-check list.

## Regression Policy
- Do not remove existing endpoints.
- Preserve old alert payload compatibility (`ticker`, `condition`, `threshold`) while supporting new schema.
- No destructive data commands.
