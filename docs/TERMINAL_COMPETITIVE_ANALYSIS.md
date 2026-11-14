# Terminal research, product audit and adoption roadmap

Research date: 14 November 2026. This report combines source inspection with publicly accessible vendor documentation. Vendor availability varies by subscription, exchange entitlement and deployment. No paid terminal account was available for hands-on comparison. Recommendations and priority scores are product judgments, not vendor claims.

Second-wave update: [the follow-up analysis](TERMINAL_ADOPTION_WAVE2_ANALYSIS.md) documents subsequently implemented onboarding, reviewed watchlist import/sorting/keyboard use, venue-aware monitoring and a revised data-quality UI. The findings and roadmap below describe the first inspection; the second-wave report records their current status and remaining boundaries.

## Product conclusion

OpenTerminalUI already has the breadth of a substantial research terminal. Its opportunity is to make that breadth easier to discover, connect and trust. Adding another isolated chart, screener or AI panel would have less immediate value than reducing the work needed to move from a question to the correct existing tool.

The strongest positioning is a self-hosted, evidence-centered research workspace for individual investors and small teams, particularly people researching both Indian and US securities. Primary-document citations, persistent theses, configurable workspaces and provider transparency support this positioning. Institutional execution connectivity, proprietary news, exchange data entitlements and global counterparty networks are separate businesses; screen count cannot establish parity with Bloomberg or LSEG.

The implementation wave accompanying this report targets task-based workflow discovery, symbol continuity, pinned/recent tool navigation, and a focused correction to the legacy experiment API's invented results. The remaining proposals below are an explicit roadmap, not a statement that every feature has been implemented.

## Repository architecture and evidence

| Layer | What is present | Product implication |
| --- | --- | --- |
| Application shell | React 18/TypeScript, Vite, React Router, lazy route loading, persistent terminal shell, command bar/palette, keyboard shortcuts and mobile navigation | An adoption layer can connect existing routes without replacing analytical engines. See `frontend/src/App.tsx`, `components/layout/TerminalShell.tsx` and `components/layout/commanding.ts`. |
| State and requests | Zustand persisted UI preferences and TanStack Query server state | Reuse established state conventions; avoid a competing workspace state system. Persisted navigation is currently browser-level rather than explicitly account-scoped. |
| Navigation | Extensive market, research, chart, derivatives, portfolio, quant and operations sections | Discoverability is a real information-architecture concern, although no user study has yet quantified it. See `frontend/src/components/layout/navConfig.ts`. |
| Personalization | Role presets for trader, quant, portfolio manager, risk and operations; preset-specific home/cockpit panels and Launchpad layouts | Role presets already exist. A task catalog should complement them instead of claiming to introduce role-based workspaces. See `frontend/src/workspace/presets.ts`. |
| Charting | Lightweight Charts v5, workstation state with crosshair/timeframe synchronization, templates and comparison views | Prioritize reliability and continuity before another chart implementation. See `frontend/src/store/chartWorkstationStore.ts` and `pages/ChartWorkstationPage.tsx`. |
| Research | Security Hub; filings retrieval; dossiers with evidence/revisions; daily monitoring; frozen research experiments; agent run context | A distinctive research lifecycle already exists. Expose sensible entry points and prerequisites. See [research workspace guide](RESEARCH_WORKSPACE_UPGRADE.md). |
| Backend | FastAPI services/routes, SQLAlchemy/Alembic, SQLite/PostgreSQL configuration, caches and optional Redis | Operations must cover schedulers, migrations and provider health, not just whether the HTTP process responds. See `backend/main.py`. |
| Market data | Provider registry and failover; stream hub; explicit quote provenance; data-quality dashboard | Data source, delay and missingness should travel with every analytical result. See `backend/services/provider_registry.py`, `marketdata_hub.py`, and `frontend/src/pages/DataQualityDashboard.tsx`. |
| Quality infrastructure | Vitest, pytest, Playwright, fixture-backed browser suites, existing ownership/provider/agent tests | Appropriate foundations exist for regression coverage. Historical reports are not evidence that the current tree passes; the current QC report must record fresh commands and outcomes. |

### Material limitations found during inspection

1. **Generic experiment endpoint is scaffolded; misleading new results corrected in this wave.** At initial inspection, `backend/experiments/service.py` constructed fixed `cagr`, `sharpe` and drawdown values, hashed configuration rather than dataset bytes, and returned a generated promotion receipt without creating a strategy. `backend/api/router.py` mounts this router. The correction now stores empty metrics, no dataset hash, and explicit `unexecuted` / `execution_engine_unavailable` tags. Existing-record promotion returns HTTP 501 with an explanatory error; missing records still return 404. This path remains configuration storage, separate from the newer dossier experiments implementation. **Historical records are preserved:** old scaffold metrics and configuration-derived hashes may remain in previously saved rows and are not certified by this fix. Review or migrate those records explicitly before relying on their performance; comparison still reflects stored historical values. No execution or promotion engine was added.
2. **At first inspection, freshness monitoring assumed US weekday hours.** This was addressed in the second wave through explicit session scopes and calendar provenance. The production US collector now selects regular cash hours, and the monitoring API supports explicit NSE/BSE cash and crypto metadata. Bundled holiday coverage remains limited; this does not establish automatic live collection for all venues. See the [second-wave limits](TERMINAL_ADOPTION_WAVE2_ANALYSIS.md).
3. **Synthetic market depth is an intentional fallback.** `backend/services/orderbook_service.py` marks generated depth as synthetic; `frontend/src/pages/DOMPage.tsx` displays a corresponding badge. Preserve this honesty and never describe simulated depth as executable liquidity.
4. **Some UI persistence is browser-wide.** Navigation and workspace-template storage keys are not account-prefixed in their stores. This may be acceptable for personal local setups but deserves explicit account-switch behavior for shared devices. Pins should store registered tools rather than private record payloads or credentials.
5. **Several services share startup lifecycle.** `backend/main.py` starts the market hub, paper engine, alert evaluator and research/screen schedulers. Multi-worker deployment requires service ownership/leases or a documented single-scheduler topology to prevent duplicate work; existing agent leases do not automatically prove all schedulers are singleton-safe.
6. **Multiple backtesting/experiment paths increase ambiguity.** Generic experiments, research dossier experiments, model lab, portfolio backtests and other engines coexist. The UI should state engine, supported strategy, dataset, cost assumptions and validation mode, and direct users to the correct path.

These are source-level observations, not a comprehensive security review or a live-feed certification.

## What comparable products teach

| Product | Verified feature pattern | Applicable lesson |
| --- | --- | --- |
| TradingView | Saved chart layouts and multi-chart synchronization; independent watchlist alert tracking as list membership changes | Preserve context between views and make repetitive monitoring cheap. Its documentation distinguishes chart settings, symbol-specific drawings and synchronization scope, a useful model for explaining local versus linked state. [Layouts](https://www.tradingview.com/support/solutions/43000746975-tradingview-layouts-a-quick-guide/), [multi-chart synchronization](https://www.tradingview.com/support/solutions/43000629990-leveraging-multi-chart-layouts-in-your-analysis/), [watchlist alerts](https://www.tradingview.com/support/solutions/43000739708-watchlist-alerts-your-trading-edge/) |
| Bloomberg Terminal | Multi-asset monitoring, research, news, collaboration, execution and personalized Launchpad workspaces | Copy workflow cohesion and fast contextual navigation. Bloomberg's data and network are not reproducible by copying its visual density. [Terminal overview](https://professional.bloomberg.com/products/bloomberg-terminal/), [Launchpad introduction](https://professional.content.cirrus.bloomberg.com/professional2023/insights/technology/bloomberg-terminal-essentials-ib-worksheets-launchpad/) |
| Koyfin | Custom watchlist views, market dashboards, saved custom dashboards and equity screening | Support reusable views and approachable market overview pages. Avoid requiring users to assemble a workspace before seeing value. [Feature overview](https://www.koyfin.com/features/) |
| LSEG Workspace | Connected data, news, analytics and cited AI workflows, with Office integration | Trace answers back to evidence and make research reusable in everyday deliverables. [Workspace overview](https://www.lseg.com/en/data-analytics/products/workspace), [Excel/PowerPoint add-in](https://www.lseg.com/en/data-analytics/products/workspace/updates/lseg-launches-workspace-add-in-for-excel-and-powerpoint) |
| OpenBB Workspace | Searchable widget library, parameter linking and preconfigured apps that combine widgets, prompts and agents | Organize entry points around analytical tasks; linked ticker/date context should be understandable and predictable. [Widget discovery](https://docs.openbb.co/workspace/analysts/widgets/overview), [parameter linking](https://docs.openbb.co/workspace), [apps](https://docs.openbb.co/workspace/analysts/apps) |
| QuantConnect | Explicit reality models for fills, fees, slippage, brokerage constraints and capacity | Treat simulation assumptions as part of the result, with reproducible configuration and engine identity. [Reality-modeling concepts](https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/key-concepts) |

## Feature matrix: extend what exists

“Present” means code exists, not complete parity or current runtime verification. “Partial” indicates a material limitation or fragmented experience. “Proposed” requires subsequent implementation.

| Capability | Repository state | Next useful enhancement |
| --- | --- | --- |
| Task-based feature discovery | Existing command navigation and extensive menus; workflow hub added in this wave | Search plain-language tasks; show ordered steps with expected outcomes and selected-security continuity. |
| Pinned and recent tools | Navigation history present; quick access added this wave | Keep tools one click away, deduplicate recents, validate persisted destinations and bound storage. |
| Role workspaces | Present | Connect task filters to role presets while letting users override recommendations. |
| Multi-chart terminal | Present | Audit drawing/timeframe synchronization, reconnects and symbol changes across all panes. |
| Workspace templates | Present | Preview templates, explain prerequisites and prevent empty unsupported widgets. |
| Watchlists and heatmaps | Present | Reusable column presets, keyboard row traversal, saved sort, bulk import preview and duplicate diagnostics. |
| Cross-asset identity | Multiple markets present | Canonical instrument ID plus exchange/currency/asset type; resolve ticker collisions before routing. |
| Alerts | Price/tick evaluation and delivery infrastructure present; richer scheduled monitoring also exists | Explain evaluator type, session, timezone, last evaluation, delivery health and test-trigger behavior. |
| News and catalysts | Present | Watchlist-scoped digest with coverage period, timestamp, sources and event-to-chart links. |
| Primary-document research | Present | Side-by-side period comparisons and change summaries linked to exact source passages. |
| Research notebook/dossiers | Present | Guided thesis setup, stale-assumption review, relationship to portfolio exposures. |
| Review inbox | Today/monitoring present | User-defined triage priorities and notification budgets, not another inbox. |
| AI analyst | Present; deterministic evaluation infrastructure exists | Evidence completeness and unsupported-claim evaluation, per-provider latency/cost tracking and task-specific prompt starters. |
| Reproducible experiments | Multiple implementations; generic registry now explicitly unexecuted with empty new metrics and unavailable promotion | Clear engine capabilities, content-addressed datasets, explicit availability dates and genuine paper promotion; historical scaffold results need separate remediation. |
| Portfolio/risk | Present | Unified benchmark/currency context, scenario assumptions and explainable contributor drill-down. |
| Paper trading | Present | Guided order-to-position-to-journal loop, clearly labeled fills and costs. |
| Live execution | Adapter/OMS components exist; broad certification not established | Only advertise supported broker/order combinations after reconciliation and failure recovery tests. |
| Data trust | Provenance and health UI present; venue-calendar limitations | Consistent freshness contracts across quotes, filings, metrics and charts. |
| Collaboration | Frozen revocable research sharing present | Team comments and review assignments with ownership controls; no assumption of real-time collaborative editing. |
| Export/integration | Existing reports, exports and MCP | Reusable evidence packet with original source links, as-of timestamps and engine versions. |
| Mobile | Navigation and responsive views present | Review-first mobile mode with predictable table overflow and accessible touch targets. |
| Adoption measurement | No unified activation funnel established in this audit | Optional local-first event counters with explicit opt-in for any remote telemetry. |

## UI/UX options and chosen direction

| Option | Best audience | Strength | Cost or risk |
| --- | --- | --- | --- |
| Chart-first workbench | Active technical traders | Chart, watchlist and alerts remain in one field of view | Can hide primary-document research and overwhelm casual users. |
| Task-first workflow hub | New users and occasional users | Answers “What should I open to do this?” without prior terminal vocabulary | Must route into real tools and avoid becoming a second static feature list. |
| Research-first daily desk | Fundamental investors and small research teams | Today inbox, dossiers and upcoming catalysts encourage a repeatable routine | Requires reliable ingestion, evidence dates and useful prioritization. |
| Modular expert workspace | Experienced analysts and quants | Adaptable linked panels and multi-monitor layouts | Blank-canvas setup cost; requires templates and recovery controls. |

Use task-first discovery as an additional entry point while retaining chart-first and expert workspaces. Preserve the current professional palette and existing density controls. Use one prominent next action per workflow, readable descriptions, labeled symbol controls, visible selected filters, semantic links and visible keyboard focus. On narrow screens stack workflow detail below selection and keep navigation independently scrollable; do not shrink the entire terminal into illegible text. Color must supplement labels rather than carry market-state meaning alone.

The immediate workflow categories should cover trader, research, portfolio, quant and macro use cases. Examples include “research a company” (Security Hub → filings/dossier → monitoring), “plan a trade” (chart → position sizing → paper order → journal), and “test an idea” (screener → backtest/model lab → risk review). A navigational step is not proof that an analytical task was completed. Keep prerequisites visible and avoid automatic order creation or silently overwriting the user's workspace.

## Prioritized implementation backlog

Relative effort: S = one bounded UI/store change; M = coordinated UI/API changes; L = engine/data/deployment work. Priorities reflect adoption and correctness, not chronological promises.

| Priority | Feature | Acceptance criteria | Dependencies / effort |
| --- | --- | --- | --- |
| P0 | Quarantine generic experiment placeholders | New results contain no invented performance; data hash describes actual data or is absent; promotion succeeds only after real paper state exists, otherwise returns an explicit unsupported response | New-result and promotion correction implemented this wave; historical remediation and real engine integration remain; M |
| P0 | Workflow hub | Search and persona filters work together; no-results state offers recovery; every destination resolves; selected ticker survives eligible steps; invalid inputs cannot create malformed navigation | Existing routes and stock context; M; this wave |
| P0 | Quick access | Pin/unpin current registered tool; bounded persisted pins; no external/unsafe destinations; recent tools deduplicate; usable at mobile width | Existing navigation history and shell; S/M; this wave |
| P1 | Provider readiness per task | Workflow displays needed source and useful setup link; missing credentials produce explanatory state, never synthetic “live” success | Provider registry/settings capability endpoint; M |
| P1 | Venue-aware freshness | US/NSE/24×7 sessions, holidays, timezone changes and half-days have fixtures; no stale alert solely because venue is closed | Exchange calendar contract and instrument metadata; M |
| P1 | Guided first useful result | Choose task and market; open a working tool without mandatory API keys where supported; optional sample inputs are labeled and separable from real data | Workflow hub and provider readiness; M |
| P1 | Instrument identity | Search distinguishes same ticker on different venues; route context includes canonical identity; unsupported mappings fail visibly | Instrument registry/provider mappings; L |
| P1 | Watchlist research loop | Arrow keys move rows, selected row updates chart/context; chosen columns/sort persist; bulk import previews accepted/rejected records | Watchlist manager, chart linking and instrument identity; M |
| P1 | Alert observability | Show condition, session, last evaluation and delivery state; deterministic test trigger; retry/dedup behavior covered | Alert evaluator, scheduler, delivery records; M |
| P1 | Consistent experiment vocabulary | Engine, data provenance, strategy limits, fees and validation mode visible before execution and in exported result | All experiment/backtest consumers; M |
| P1 | Reliable scheduler deployment | Defined single-worker or lease ownership for each background job; restart/retry test cannot duplicate notifications/orders | Deployment topology, persistent job identities; L |
| P2 | Saved task state | Resume explicit task and security across reload; never infer task completion from merely opening a page | Versioned task session schema; M |
| P2 | Watchlist morning brief | User selects watchlist; digest states source/time coverage; each item opens relevant evidence/tool; unavailable feeds explained | News/events/filings ingestion; M |
| P2 | Filing change comparison | Prior/current passages side by side, date/period labels and numerical changes checked; unsupported AI claims excluded | Document versioning and retrieval; L |
| P2 | Research review assignments | Account-scoped comments/assignees with audit trail; frozen sharing never leaks private notes | Team ownership and sharing contracts; L |
| P2 | Portfolio scenario workspace | Shock assumptions, base currency, as-of data and contributor breakdown visible; unsupported asset repricing declared | Risk/FX/valuation coverage; L |
| P2 | Reproducible evidence export | Export includes sources, dates, dataset identifiers, cost assumptions and engine version; reopening does not silently refresh frozen evidence | Existing exports/report generation; M |
| P2 | Account-aware UI persistence | Account switch cannot expose prior user's private routes/selections; migration preserves safe public tool pins | Auth lifecycle and persisted-store schema; M |
| P2 | Mobile review mode | Core workflows usable at 390px and keyboard zoom; tables scroll in their own region; critical actions remain visible | Shared shell and targeted page work; M |
| P2 | Accessibility hardening | Keyboard-only workflows, dialog focus return, named controls and AA contrast checked in both themes/densities | Shared component audit; M |
| P2 | Performance budgets | Record route chunk sizes, interaction timings and visible request counts; prevent hidden-pane polling and unbounded tables | Production build profiling and query audit; M |
| P3 | Broker execution expansion | Explicit supported matrix, duplicate-order prevention, partial-fill/reconnect/cancel reconciliation, paper/live separation | Broker credentials, venue access and execution engine; L |
| P3 | Extensible widget ecosystem | Trusted-code boundary or real sandbox documented; widget capability/version contracts and resource limits enforced | Widget registry/security model; L |
| P3 | Office-style research integration | User exports reusable tables/charts with citations; linked refresh explicit and access controlled | Export APIs and entitlement policy; L |

## Adoption measurement

Collect optional local-first product events without recording security research text, portfolio values, credentials or document contents. Remote analytics needs a separate consent decision.

| Metric | Definition | Decision it informs |
| --- | --- | --- |
| Time to first useful view | Time from first authenticated shell to opening a supported tool with valid context | Whether workflow discovery improves activation. |
| Task discovery success | Share of hub sessions that open a matching tool, segmented by query and persona | Missing vocabulary, poor ranking and empty results. |
| Context continuity | Share of eligible workflow transitions retaining canonical selected security | Whether the hub reduces repetitive symbol entry. |
| Pin adoption | Users with at least one pin and subsequent pin usage | Value of quick access rather than raw feature exposure. |
| Research lifecycle | Dossier created → source evidence added → review revisited, measured separately | Whether users complete research rather than browse screens. |
| Monitoring usefulness | Reviewed/acknowledged events versus dismissed/repeated events | Alert quality and notification overload. |
| Reliability | Error rate, unavailable-provider rate, stale-result rate, route-load duration | Whether a discoverable workflow actually works. |
| Return use | Seven-day repeat task use and saved workspace reopens | Habit formation, with no unsupported causal claim. |

Establish a baseline before setting targets. Compare cohorts with the same provider configuration and market hours; an unavailable feed is not a failed onboarding design. Avoid using trade count or time spent as the primary success measure.

## Required release evidence

Record fresh build/unit test outcomes, changed-feature browser tests, screenshots at desktop/mobile widths, console errors, route destinations, persisted-state recovery and data-provider limitations in the accompanying QC report. Functional checks should exercise filtering, symbol validation, step navigation, pin/unpin, reload persistence and recent-history behavior. Full backend results are useful regression evidence, but neither fixture tests nor passing unit tests certify live vendor feeds, model answer quality or institutional execution readiness.
