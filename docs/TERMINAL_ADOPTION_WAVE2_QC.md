# Second-wave implementation and quality report

Date: 14 November 2026. This follows commit `62496c4`; it is a separate implementation pass. The [research report](TERMINAL_ADOPTION_WAVE2_ANALYSIS.md) contains competitor references, repository findings, three UX options and 22 prioritized follow-ups. Its roadmap is separate from the delivered features below.

## Implemented

1. **Getting Started** at `/equity/getting-started`, available through Home, navigation and `SETUP`/`ONBOARD`. Five goal-specific next actions, actual relevant provider status, actual watchlist availability and creation, explicitly manual research confirmations and per-account browser preferences. Public data access does not require optional paid provider keys.
2. **Watchlist migration and review** in the existing manager. Paste or choose TXT/CSV; inspect invalid, duplicate and existing symbols; confirm a single bulk API mutation; retain review after failure; disable competing mutations while pending. Recognizes explicit exchange-qualified comma-separated TradingView TXT entries, with section markers skipped rather than recreated as groups. Limits: 64 KiB, 500 entries and 40 characters per qualified symbol. Syntax acceptance does not verify a listing or provider coverage.
3. **Watchlist productivity.** Remembered manual/symbol/price/change sort, unknown values last, keyboard Arrow/Home/End row traversal, Enter/Space to open Security Hub with encoded identity, and preserved context menu/export/heatmap behavior.
4. **Venue-aware monitoring.** Explicit US regular/extended scope, NSE/BSE cash sessions and continuous crypto assumptions. Local-session day counters, no artificial overnight cash gaps, supported bundled holidays and 2026 US early closes, market-specific stale alerts and explicit unknown states. Additive API fields expose calendar source, coverage, notes, timezone, session dates and boundaries.
5. **Data trust UI.** Actual provider/monitoring sources instead of process liveness; per-symbol sessions; closed versus stale versus unknown; unavailable sources and retry; known-calendar-only session missing-bar aggregate; search and coverage filters. The operations panel also shows market/session scope and nullable expectations.

Three swarm agents owned watchlist implementation, onboarding implementation, and backend sessions/research. The coordinating agent integrated navigation and commands, rebuilt data-health reporting/UI, reviewed contracts, and performed whole-change QC.

## Automated verification

| Verification | Outcome | Evidence |
| --- | --- | --- |
| Full frontend regression | **806 passed, 156 files** | `npm --prefix frontend test -- --reporter=dot`; `/tmp/openterminal-wave2-final-vitest.log` |
| Production TypeScript/Vite build | **Passed** | `npm --prefix frontend run build`; `/tmp/openterminal-wave2-final-build.log` |
| Backend final regression selection | **70 passed** | Command below; `/tmp/openterminal-wave2-backend.log` |
| Backend agent's earlier session/provider selection | **60 passed**, including data-quality lifecycle | Exact command in research report; overlaps final selection and must not be added to 70 as unique tests |
| Patch whitespace check | **Passed** | `git diff --check` |

Final backend selection:

```sh
.venv/bin/python -m pytest \
  backend/tests/test_watchlists_ownership.py \
  backend/tests/test_venue_data_quality.py \
  backend/tests/test_market_calendar.py \
  backend/tests/test_ws/test_ws_us_quotes.py \
  backend/tests/test_ws/test_marketdata_hub_candles.py \
  backend/tests/test_marketdata_hub_bookkeeping.py \
  backend/tests/test_providers_status.py \
  backend/tests/test_provider_registry.py \
  backend/tests/test_reports_market_status.py \
  backend/tests/test_auth.py -q
```

Tests cover import quoting/delimiters/BOM/size/row/symbol bounds, explicit exchange conflicts, native TXT and ambiguous-format rejection, pending duplicate submissions, retained review after failure, sorting and keyboard behavior, seeded default watchlists, onboarding preference isolation and provider failures. Monitoring tests cover DST, weekends, holidays, supported early closes, cash overnight boundaries, local-session dates across UTC midnight, continuous crypto gaps, unsupported venues/years and stale-alert de-duplication. Data-health tests cover partial/malformed responses, missing sources, unknown expectations and statuses, empty monitoring and session filtering.

## Actual browser functional checks

Chromium was exercised through Playwright CLI against the React app on `127.0.0.1:5174` and the updated FastAPI backend on `127.0.0.1:8010`. The isolated database is `/private/tmp/openterminal-workflow-qc.db`; explicit repository development auto-login remains confined to that test frontend/backend. Normal authenticated development UI remains at port 5173. No production authentication code changed and no live orders were placed.

The main browser callback passed **19 assertions**:

- Goal actions route into actual tools; selected goal and manual confirmation survive reload.
- Blank watchlist name is rejected; a personal list is created through the actual API despite the seeded default list.
- CSV review does not mutate data, identifies duplicate/invalid rows, and confirmation sends exactly one bulk request.
- A subsequent GET verifies only reviewed symbols were persisted.
- Qualified native TradingView TXT identifies existing/duplicate/section entries and imports only the new symbol.
- Sorting survives reload; ArrowDown selects the next sorted row; Enter opens the actual Security Hub with encoded market identity.
- Actual empty monitoring is explained without inventing bar counts.
- Getting Started, watchlist import and Data Quality avoid document overflow at 390 pixels; no uncaught JavaScript errors occurred in these normal flows.

A separate failure/session callback passed **10 assertions**: intentional HTTP 503 import failure retains input/preview, retry succeeds against the real API, a provider's self-reported error cannot establish readiness, unavailable monitoring has an explicit error state, retry restores the actual report, a backend-generated session fixture renders unknown expectations, closed/unknown filters isolate the correct rows, and the actual GO bar executes `SETUP`.

An additional visual/responsive pass checks Getting Started and Data Quality at 320/768/1440 pixels and watchlist import at 320/768. Intentional fault responses were removed after the failure checks. The data-health fixture screenshot includes a visible QC label; fixture observations are never presented as live market data.

## QC fixes found during implementation

- The real GET watchlists API auto-seeds a default list, making an empty-list-only create form unreachable. The form now remains available and its checklist describes saved-list availability without claiming a personal accomplishment. A realistic seeded-list regression test was added.
- Native comma-separated preview rows share a source line; unique keys now include their entry index.
- Unknown provider/feed states and provider-reported errors no longer fall through to a healthy aggregate.
- Failed monitoring is distinguished from a successful empty report; unknown calendars cannot contribute invented zero expectations.
- Data-health source requests no longer confuse root liveness or a frontend HTML fallback with actual data coverage.
- Session counts/stale alerts no longer apply a US extended-hours window to every instrument.

## Review artifacts and limits

Files under `output/playwright/`:

- `wave2-functional-check.js`: main callback, creates a new isolated QC list on each replay.
- `wave2-failure-session-check.js`: failure/fixture callback, records the QC list used for this run.
- `wave2-session-fixture.json`: deterministic report produced by the actual monitoring service at a frozen time, not live observations.
- `wave2-getting-started-desktop.png`, `wave2-getting-started-mobile.png`.
- `wave2-import-review-desktop.png`, `wave2-import-review-mobile.png`, `wave2-import-failure-recovery.png`.
- `wave2-data-quality-live.png`, `wave2-data-quality-mobile.png`, `wave2-session-fixture-desktop.png`.

The full frontend suite emits existing React/router/jsdom warnings; the production bundle retains an existing large-main-chunk warning. Backend startup still logs the existing Twisted signal warning and configured Kite/Finnhub credentials are rejected. The US feed monitor is therefore empty in the actual browser session. Other snapshot/public data can still be available. These checks validate behavior and failure recovery, not live-feed entitlements or complete terminal parity.

Calendar logic reuses bundled 2026 holidays and explicitly labels coverage; unscheduled closures, special Indian sessions and other derivatives/FX/futures calendars are unsupported. India/crypto session support is a monitoring capability requiring explicit metadata, not a new automatically connected live feed. Onboarding preferences are per-account but local; existing watchlist sort remains browser-wide. This report describes local validation; no deployment was performed.
