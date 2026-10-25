# End-to-end validation

Run date: 2026-10-25. Tested the research workspace changes from `44096a8` and the export fix discovered during this run. The browser used the running frontend and API with an isolated SQLite database, not mocked research endpoints or a production account.

## Research workflow

| Browser action | Result |
| --- | --- |
| Create a fresh AAPL dossier and reload | Title, thesis, assumptions and company logo persisted/rendered |
| Edit thesis and save | New revision persisted |
| Add evidence from Apple's official FY2025 Q1 statements | Claim, source URL, publication date and supporting stance saved |
| Search locally ingested official statements | Three source passages returned; original passage added to evidence |
| Search before publication | No passages returned |
| Check changes | Monitoring request completed |
| View revision history | Saved revisions displayed |
| Download dossier evidence | Downloaded JSON independently verified against its SHA-256 after the fix below |
| Create a read-only link | Shared page and public snapshot endpoint readable |
| Revoke that link | Previously opened page became unavailable after reload |
| Create a controlled-data SMA experiment | Saved training/validation results displayed |
| Replay the saved experiment | Results matched; zero provider requests |
| Download experiment | Downloaded snapshot independently verified against its SHA-256 |
| Edit from two tabs | Stale save rejected with HTTP 409; unsaved draft retained |
| Review at 390 × 844 | Document width remained 390 pixels |
| Follow company overview | Navigated to `/equity/security/AAPL` and returned |
| Delete the test-created dossier and reload | Dossier removed; original Apple research preserved |

## Failure found and fixed

The original browser downloads parsed and reserialized the server's JSON. JavaScript changed numeric representations such as `5.0` to `5`, breaking the Python-generated snapshot digest even though the displayed values were equivalent. Dossier and experiment downloads now request a Blob and save the original server bytes. Regression tests verify the raw response type and unchanged Blob passed to the downloader.

Both repaired downloads were checked outside the browser with Python's canonical JSON serialization and SHA-256. Experiment verification excludes response-envelope fields `id`, `dossier_id` and `created_at`, matching the stored snapshot hash contract.

## Workspace browser checks

Seven checks passed against the real local app without mocked workspace endpoints: layout import; AAPL/date/USD context groups retained in exported JSON; panel removal and undo; rejection of an invalid import version; density selection; preference persistence after reload; and mobile monitoring/alerts at 390 pixels with no horizontal overflow. The final run recorded zero browser runtime exceptions. Screenshots: `output/playwright/workspace-e2e-desktop.png` and `workspace-e2e-mobile.png`.

## Agent lifecycle browser checks

A separate isolated server used real registration/login, agent routes, execution storage and SSE with a deterministic scripted model provider. The browser created a run, streamed events, stopped it, resumed the same run and received completion. Another running request survived a page reload; reconnect/replay restored the run and completed it. Its downloaded evidence export reports `status: done` and contains four recorded events.

The browser also reviewed and confirmed a paper-order proposal through the real confirmation endpoint. This scenario used a deliberately synthetic `NASDAQ:E2ETEST` mark in the isolated paper engine, not a broker or real market execution. These checks validate the application lifecycle and controls, not live model intelligence or trading performance.

Artifacts: `output/playwright/agent-cancel-resume.png`, `agent-reload-reconnect.png`, `agent-run-evidence.json`, `agent-paper-review.png`, and `agent-paper-confirmed.png`.

## Evidence and limits

Automated verification after the export fix: **1,564 backend tests passed** (18 warnings), **659 frontend tests passed across 137 files**, and the production TypeScript/Vite build passed. The existing large-bundle build advisory remains. Commands: `.venv/bin/python -m pytest backend/tests -q --disable-warnings`, `npm test -- --reporter=dot`, and `npm run build` (frontend commands run in `frontend/`).

Browser artifacts are under `output/playwright/`, including `e2e-dossier-export-fixed.json`, `e2e-experiment-export.json`, `e2e-experiment-results.png` and `e2e-research-mobile.png`. These local files are not production fixtures.

Financial evidence came from the real official Apple PDF already documented in [real-data validation](REAL_DATA_VALIDATION.md). Successful experiment creation used a clearly labeled deterministic fixture with controlled availability timestamps. Real downloaded Yahoo bars without historical availability proof are separately tested for correct rejection; no historical timestamps were invented.

This local browser session uses the development test-login mode. Ownership and production authentication behavior are covered by backend tests, not claimed as a production-login browser certification. Live vendor availability and live model answer quality remain outside the deterministic acceptance checks.
