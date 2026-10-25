# Research workspace upgrade

This implementation connects research, agent execution, and configurable workspaces. It does not require live model credentials to exercise the deterministic tests.

## Delivered

| Area | Behavior |
| --- | --- |
| Research dossiers | Private thesis and assumptions, sourced evidence, optimistic concurrency, immutable revisions, linked owned agent runs, evidence exports |
| Monitoring | Opt-in 15-minute checks of ingested filings, materiality thresholds, deduplicated observations and in-app notifications; manual checks and a mobile monitoring page |
| Sharing | Frozen public read-only snapshots, token rotation and revocation, exclusion of private run and portfolio links |
| Filing retrieval | Publication-date and period filters, word/character hybrid retrieval, optional reranking hook, passage references and content hashes |
| Experiments | CSV input with explicit provenance/availability dates, frozen single-instrument SMA tests, costs, chronological validation and deterministic replay |
| Agent runtime | Durable requests/events/tool checkpoints, cancellation, reconnect/replay/resume, worker leases, account-scoped browser recovery, evidence exports |
| Agent context | Recent conversation budgeting, valid structured tool summaries, route-scoped selections and dossier context, bounded debate concurrency |
| Agent actions | Reviewable research-note, watchlist removal, supported tick-alert and marked-price paper-rebalance proposals; conservative recovery of uncertain writes |
| Agent interface | Overlay/docked/expanded layouts, recovery controls, readable proposal payloads, save answers to dossiers and pin artifacts |
| Workspace | API-backed research panels, validated versioned layout import/export, undo, symbol/date/currency groups, trusted bundled widget registration |
| Everyday usability | Results-first screener, provider setup checklist, density/text-size settings, optional overlays, mobile navigation, modal focus and development service-worker fixes |
| Evaluation | Offline captured-run evaluation and reference-fixture checks; no claim of a live-model quality benchmark |

## Running and upgrading

Use the repository's normal backend/frontend setup. Apply Alembic migrations through `0013_agent_execution` using the deployment's configured database before starting upgraded workers. Migrations `0012` and `0013` add research and durable agent tables. Back up an existing database before normal deployment migrations. The migration tests cover fresh schemas and baseline compatibility; no production database was modified during validation.

Dossier monitoring is opt-in per dossier and only examines locally ingested filings. `RESEARCH_DOSSIER_MONITOR_ENABLED=0` disables its scheduler globally. Configure the existing ingestion and provider services separately.

Open Research dossiers or Monitoring from navigation. Create a dossier, add evidence, and use its experiment section to import timezone-qualified CSV bars. Agent answers can be saved into a dossier. Layout controls provide workspace export/import, undo and context groups.

## Verification

- Full frontend Vitest suite: 645 passing tests across 134 files; production TypeScript/Vite build passed. The build retains its existing large-chunk advisory.
- Full backend pytest suite: 1,551 tests passed (18 warnings). Coverage includes ownership, migrations, durable execution, proposals, retrieval, monitoring and frozen experiments.
- Browser checks against an isolated SQLite API: create/edit dossier, add evidence, monitor, share/revoke, CSV experiment creation and matching replay. Mobile dossier viewport checked at 390 × 844 with no horizontal overflow.
- Workspace browser checks with controlled API responses: panel rendering, layout undo/export, context groups, settings and mobile monitoring.
- Screenshots are under `output/playwright/`. Tests use controlled providers or supplied data; these results do not certify live vendor feeds or live LLM behavior.

## Explicit boundaries

Monitoring presents source/keyword changes for analyst review; it does not establish semantic contradictions. Hybrid retrieval is lexical, not embedding-based. Experiment provenance is supplied by the caller, and replay currently supports single-instrument SMA rather than arbitrary strategies or historical universes. Currency groups carry requested context without inventing FX conversions.

Screen-result alerts support the existing tick-condition evaluator. Arbitrary fundamental expressions and scheduled universe scans are rejected until an evaluator exists. Recovery reuses completed tool evidence but may regenerate different model prose; uncertain writes are never automatically repeated. Widget registration is for trusted bundled code, not a sandbox for untrusted third-party plugins.

## Implementation references

- [Agent execution and recovery](AGENT_RUNTIME.md)
- [Dossiers, monitoring, retrieval and experiments](RESEARCH_DOSSIERS.md)
- [Workspace widget and layout contracts](WORKSPACE_WIDGETS.md)
- [Offline evaluation](../backend/evaluation/README.md)
