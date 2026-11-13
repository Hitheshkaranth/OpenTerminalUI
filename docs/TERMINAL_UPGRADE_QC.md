# Terminal workflow upgrade: implementation and validation

Validation date: 14 November 2026 (Asia/Kolkata).

## Delivered scope

Three agents researched and implemented separate workstreams, followed by integration and browser verification. The [competitive analysis](TERMINAL_COMPETITIVE_ANALYSIS.md) contains the repository audit, official vendor sources, capability matrix, UX alternatives, 24 prioritized proposals and acceptance criteria. These proposals are a roadmap; this change delivers the adoption layer and a specific correctness fix.

- `/equity/workflows`: eight guided workflows, 36 searchable tools, five purpose filters, saved workflow bookmarks and selection, useful search empty states, symbol validation, compatible contextual links, prerequisite guidance and provider-quality links.
- Shell quick access: shared sidebar favorites, current-tool pin/unpin, recent registered tools, bounded storage, legacy pin compatibility and mobile scrolling. Intentionally empty favorites now survive reload.
- Entry points: Home action and launch matrix, navigation registry, command palette and GO bar. `FLOW`, `WORKFLOW`, `WORKFLOWS` and `START` open the hub; `AAPL FLOW` and `FLOW AAPL` pass symbol context.
- Legacy experiments: new records retain configuration with empty metrics, a null dataset hash and explicit unexecuted tags. Promotion returns HTTP 501 until execution integration exists; missing IDs return 404. No existing records are rewritten.

## Automated verification

| Check | Result | Evidence |
| --- | --- | --- |
| Initial frontend baseline | 715 passed, 147 files | `/tmp/openterminal-baseline-vitest.log` |
| Full integrated frontend suite | 752 passed, 151 files | `npm --prefix frontend test -- --reporter=dot`; `/tmp/openterminal-final-vitest.log` |
| Production TypeScript/Vite build | Passed | `npm --prefix frontend run build`; `/tmp/openterminal-build.log` |
| Selected backend regression | 52 passed across 10 files | Command below |
| Patch whitespace check | Passed | `git diff --check` |

The first integrated frontend run caught two new alias-routing failures: the parser interpreted single-word aliases as tickers. Workflow aliases now resolve explicitly; the full suite was rerun successfully.

```sh
.venv/bin/python -m pytest \
  backend/tests/test_legacy_experiment_truth.py \
  backend/tests/test_experiments_registry.py \
  backend/tests/test_research_experiments.py \
  backend/tests/test_model_lab_routes.py \
  backend/tests/test_model_lab_metrics.py \
  backend/tests/test_search_route_us_inclusion.py \
  backend/tests/test_instrument_search.py \
  backend/tests/test_provider_registry.py \
  backend/tests/test_providers_status.py \
  backend/tests/test_data_quality.py -q
```

New frontend coverage includes catalog relationships, encoded destinations, purpose categories, symbols, filters, persistence recovery, favorites bounds/sanitization, recent-tool filtering, current-tool pin behavior and command aliases. Existing sidebar/navigation regressions also run in the full suite. Backend tests cover truthful new experiment records and rejected promotion alongside research/model engines, search, providers and data quality.

## Browser functional checks

Used Playwright CLI with Chromium against React and FastAPI. The isolated test environment uses the repository's development auto-login on port 5174 and SQLite at `/private/tmp/openterminal-workflow-qc.db`. Normal frontend login remains on port 5173. Production authentication code was not changed.

Verified:

1. Authenticated route renders the actual shell and workflow hub.
2. Applying AAPL updates compatible Security Hub links; symbols containing spaces receive an accessible validation error.
3. Macro filtering selects its guided workflow. A nonexistent search shows both empty states; clearing it restores results.
4. Workflow bookmarks survive reload and a destination round-trip.
5. Current-tool favorites survive reload and update the sidebar.
6. WORKFLOWS executes through the actual GO bar.
7. Layouts at 390, 768 and 1440 pixels avoid document-level horizontal overflow; search remains accessible.
8. Clicking a workflow step opens the real Security Hub route with AAPL context, and browser Back returns to the hub.
9. Keyboard Tab moves from search to the bookmark filter.
10. No uncaught JavaScript errors during the main functional scenario. Its final console showed zero errors and two existing React Router future-version warnings.

Screenshots: `output/playwright/workflow-hub-desktop.png`, `workflow-hub-full.png`, `workflow-hub-mobile.png` and `workflow-hub-mobile-steps.png`. The main browser callback is saved as `output/playwright/workflow-functional-check.js` for replay through Playwright CLI `run-code`. Snapshots are retained in `.playwright-cli/`.

## Limits and residual findings

- This is scoped regression and functional verification, not a claim that every backend test and every tool workflow passed. Vendor research used official public documentation; no paid terminal account was available for hands-on comparison.
- Existing frontend tests emit React act/router warnings and jsdom canvas/network noise. The production build retains a large-main-chunk warning. Backend regression emits one Starlette/httpx deprecation warning.
- An initial browser attempt preceded backend startup and produced transient proxy errors. The backend was started, the page reloaded, and functional verification repeated successfully.
- Configured Kite/Finnhub credentials were rejected by providers. Missing data stays unavailable. These checks do not certify live feeds, exchange coverage or order execution.
- Backend startup logged an existing Twisted signal-installation warning; HTTP startup completed. Lifecycle improvements remain on the roadmap.
- Preferences are browser-local; they do not sync between users, devices or tabs automatically. Workflows guide navigation; they do not execute or mark research steps complete. Recent-tool links open tool entry routes.
- Symbol context applies to compatible routes. The chart workstation retains its own symbol state; options require supported underlying selection. Universal linkage is not claimed.
- Historical legacy experiment rows can still contain old dummy metrics. They were preserved for review. Research/model experiment engines use separate routes and were included in regression checks.
- Global freshness monitoring still needs exchange-specific sessions and holidays, as described in the competitive analysis.
