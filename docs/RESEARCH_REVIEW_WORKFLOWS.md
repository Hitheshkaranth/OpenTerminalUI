# Research review workflows

This release connects saved research, scheduled discovery, earnings reviews, portfolio relationships and frozen experiments through the **Today** page (`/equity/monitoring`). Existing watchlist and alert views remain available there. Today is included in the default pinned navigation; existing custom pins are preserved.

## Review changes without losing context

Today has Needs review, Upcoming and Reviewed queues. Material dossier changes are grouped by revision; screen membership changes are grouped by check. Select an event to open its evidence drawer. Source quotes, fiscal periods, units and previous/current values remain attached to the observation. Desktop uses a side drawer; mobile uses the full screen. Keyboard focus is contained in the drawer and returns when it closes.

Mark reviewed only acknowledges an event. It does not change a thesis, evidence or a screen. Reopen, undo and 24-hour snooze persist per account. Snoozed events return after expiry. Dossier and screen links preserve the selected record, and review filters are retained in the URL.

Coverage separates previously checked dossiers, checks in the last 30 minutes, monitoring disabled, schedules awaiting their first check, failed/partial/overdue scans and source-fetch issues. An empty queue is not evidence of complete coverage.

## Measurable thesis assumptions

A dossier can contain numeric conditions with a metric, unit, operator, threshold and optional fiscal period. Explicit percentage thresholds found in the user's thesis can be offered as editable suggestions; nothing is enabled until saved. Users can revise, pause or remove conditions, undo removal, and record a dated source quotation as an observation.

The evaluator reports Within threshold, Breached or Unknown. It requires comparable metric/unit/period and a dated source. Conflicting values, future observations, ambiguous periods or missing evidence remain Unknown. Recognizable fiscal quarters and period-end dates are ordered by reporting period rather than blindly selecting the last published document. Late restatements of older periods do not replace newer results.

Saving observations or earnings actuals creates material condition-change events immediately. Background monitoring examines saved filings every 15 minutes when enabled. Deterministic filing extraction recognizes explicit percentage statements and rejects ambiguous or forward-looking language; it does not claim general semantic contradiction detection.

### Optional source ingestion

Enable **Fetch new SEC/NSE filings daily** in a dossier to fetch source documents before monitoring. Manual Check changes can request a fresh check. This reuses SEC/NSE collectors and requires `FILINGS_WATCH_ENABLED` to permit fetching; `RESEARCH_DOSSIER_MONITOR_ENABLED=0` disables the dossier scheduler. No model is required.

Fetch status distinguishes checked, partial, failed, disabled and unconfirmed. A provider returning no documents does not establish that no filing exists. Source access, supported document types and rate limits still depend on the provider.

## Scheduled fundamental screens

Save a screen, then use **Follow this screen** in the screener:

1. Preview a supported universe, daily/weekly schedule and maximum observation age.
2. Inspect requested/evaluated coverage and missing, stale or unknown measurements.
3. Save the schedule; inspect Current matches, Changes and Schedule.

The first successful evaluation establishes the baseline. Later evaluations record entries/exits, the exact conditions that changed truth value and their before/after metrics. Missing or stale observations never imply an exit. A previously unresolved company becomes baseline when data first becomes usable. The selected saved-screen query is restored from inbox deep links.

Schedules persist in the database and use an atomic cross-worker lease. The worker checks due schedules every minute, refreshes provider observations in bounded rotating batches and retries failures after 15 minutes. `SCREEN_MONITOR_ENABLED=0` disables this worker. `SCREEN_MONITOR_REFRESH_CAP` sets the per-run batch size (default 60; maximum 1,500). The UI reports attempted and refreshed counts.

Supported rules are explicit numeric comparisons over available snapshot fields, including valuation, profitability and growth metrics. Unsupported expressions are rejected. Observation time is not a financial statement's historical publication time. Delivery is in-app through Today; no external messages are sent by these workflows.

## Earnings expectations and outcomes

Record a period, expected report date, your forecast, management guidance and sources. Save before results to preserve the original expectations. Later, record sourced actuals and review notes. The comparison shows expectation, guidance, actual and difference, with percentages expressed as percentage-point differences.

Original forecast and guidance fields cannot be rewritten in a saved review. Revised forecasts use a new review. Retrospective comparisons are labeled. The management delivery summary uses the latest sourced forecast per metric/period saved before publication; incomplete and retrospective comparisons are excluded. Above or below guidance is descriptive, not automatically favorable or unfavorable.

Existing provider results and extracted guidance are available as reference data; users confirm fiscal period, accounting basis, units and sources before saving actuals. Pending report dates appear in Upcoming. Actuals become evidence for the dossier's conditions.

## Portfolio research impact

Today → Portfolio impact uses account-owned portfolios from Portfolio Manager. Shared supplier, customer, commodity and exact thesis-condition relationships are ranked by affected holdings. Expand a row for citations and dossier links, or explore the relationship view.

Holdings weights and business exposure are distinct. Holdings weights use available, non-synthetic quotes in the portfolio currency; incomplete quote coverage suppresses the denominator and resulting weights. Cash is excluded. Relationship citations and source coverage are reported separately. A disclosed business share is shown only when a valid share matches a cited percentage. Inferred relationships are labeled, and missing citations remain unknown coverage. Relationships overlap: their weights must not be summed as predicted losses.

## Dataset readiness and replay

Research experiments begin with dataset preflight before strategy configuration. Readiness reports row range, gaps, timestamp availability and provenance. Users choose:

- **Exploratory:** use historical prices without asserting point-in-time availability.
- **Point-in-time verified:** retain the strict supplied-availability checks; unavailable timestamps cannot be guessed or backdated.

SMA crossover, EMA crossover and buy-and-hold run on frozen single-instrument rows with costs, chronological validation and deterministic replay. Replay makes no provider requests. The snapshot/export retains the mode, raw CSV SHA-256, normalized-data hash, availability coverage, adjustment declaration and optional historical membership/delisting evidence. Bars after a supplied delisting date are rejected.

Verification checks the supplied timestamps and provenance; it is not an independent vendor audit. Historical universe membership is retained as provenance, not a claim that this single-instrument engine implements historical-universe selection or removes survivorship bias. Corporate-action adjustment status is declared, not independently reconstructed.

## Upgrade and validation

Apply Alembic through `0014_research_review` using the deployment's normal migration procedure. The revision adds `research_review_states`, `screen_monitor_schedules` and `screen_monitor_changes`. Dossier additions use existing versioned JSON payloads. Tests cover repeated upgrades, schema/model parity and ownership. No production database was used during implementation validation.

Targeted suites cover source ingestion through the real parser/store to the inbox, numeric conditions and fiscal ordering, frozen forecasts, review/undo/snooze ownership, missing-data screen transitions, scheduler leases, portfolio provenance/aliases, and exploratory/PIT replay. Desktop/mobile browser checks use an isolated SQLite database and explicitly labeled controlled fixtures. Browser artifacts are in `output/playwright/`; fixtures do not certify live vendor coverage or investment performance.

Validation also exposed an existing Python execution timeout defect: the API returned a timeout while leaving the script running in a daemon thread with process-global stdout capture. Execution now uses a child process that is killed and reaped at the deadline. The Windows packaged launcher has a dedicated worker dispatch before application startup. Regression tests verify termination, subsequent-request output isolation and packaged command selection.

### Final validation — 2026-11-01

- Clean full backend gate: **1,663 passed**, 18 warnings, **75.73% coverage** (required 45%), exit 0 in 139.17 seconds.
- Full frontend suite: **688 passed across 143 files**.
- Production TypeScript/Vite build passed; existing large-bundle advisory remains.
- Backend and Windows launcher compile checks and `git diff --check` passed.
- Fresh SQLite Alembic upgrade through `0014_research_review` passed; repeated migration/schema parity is covered by tests.
- Existing authentication smoke and corrected screener Playwright regression passed. The repository's three legacy mobile interaction tests remain skipped by their existing configuration; the new research workflows were separately exercised on mobile in real browser sessions.
- Actual isolated-API browser checks covered dossier/condition creation, sourced breach, review/undo/snooze, preserved navigation, frozen earnings forecasts/actuals, schedule preview/save/run/transitions, portfolio citations/coverage/navigation, exploratory EMA and verified buy-and-hold save/replay. Replay used zero provider calls. New mobile surfaces were checked at 390 × 844 with no page overflow.
- One scheduled-screen refresh exercised configured live providers: 53 of 60 attempted snapshots refreshed, 50 of 101 universe members evaluated; missing/incomplete coverage remained visible. Entry/exit and source-evidence assertions used explicitly labeled controlled fixtures.

Test servers used a temporary database and were stopped after validation. Existing production accounts/databases were not migrated or seeded.

### Visual research review

The review pages now include data visualizations alongside their exact values and source links:

- Today shows separate coverage meters for previously checked dossiers and evaluated screen companies. A missing denominator remains unavailable.
- Thesis conditions plot the threshold, previous observation and latest observation on a labelled scale. Earnings plot recorded forecasts and actuals with guidance bands where provided; each metric retains its own unit and scale.
- Screen monitoring charts data coverage, recorded entry/exit counts and selectable before/after metrics with saved-rule thresholds. Missing observations are not plotted as zero and the first run remains a baseline.
- Portfolio impact provides ranked, clickable holding-count bars; a portfolio-weight toggle requires complete comparable quotes. The relationship matrix distinguishes disclosed links, inferences, user assumptions and unknown links. Neither plot sums overlapping relationships into total exposure.
- Frozen experiments plot recorded equity returns and drawdowns, with independent training/validation periods and keyboard-accessible observation inspection. Legacy results without recorded curves show available summary comparisons only.

MTAR Technologies (India, MTARTECH) was used for live verification. Historical consolidated Q2/Q3 FY2026 figures were sourced from the company's January 2026 presentation at https://mtar.in/wp-content/uploads/2026/01/Investors-Presentation-31.12.2025.pdf (page 10). The test dossier explicitly labels its 20% margin threshold as an illustrative rule, leaves unrecorded forecasts/guidance unavailable, and does not claim these are the latest results. The isolated demo also contains a clearly labelled hypothetical one-share portfolio; it is not an actual user holding.

An exploratory MTAR experiment uses 248 downloaded Yahoo MTARTECH.NS daily price rows (2025-10-30 through 2026-10-30), with source URL and file hashes retained. Historical availability remains unknown, so the dataset is not labelled point-in-time verified. Saved replay matched with zero provider requests. MTAR's official logo is bundled with source attribution so it remains available when provider metadata fails.

Desktop and 390px mobile browser checks verified chart controls, readable values, source drill-down, logo loading and no page-width overflow. Live MTAR fundamental refresh encountered provider authentication/rate-limit failures. The screen's wider NSE run evaluated 51 of 1,500 companies, with 1,440 missing and nine incomplete; MTAR remained missing, and the initial baseline generated no transitions. These limitations remain visible rather than being filled with invented measurements.

Visual-update validation: 715 frontend tests passed across 147 files; production TypeScript/Vite build passed (existing bundle-size advisory).
