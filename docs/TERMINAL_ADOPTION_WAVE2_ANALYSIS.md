# Terminal adoption upgrade: second-wave analysis

Research and source inspection date: **14 November 2026**.

This report extends [the first competitive analysis](TERMINAL_COMPETITIVE_ANALYSIS.md). It separates delivered code from proposed follow-up work and records only verification performed directly for the backend session changes. The release QC report owns final frontend build, browser, screenshot and whole-change results.

## Why this wave follows discovery

The first wave delivered the Workflow Hub, guided route discovery with selected-symbol continuity, pinned/recent tool access, and a correction to the legacy experiment API's invented metrics and promotion receipts. Those changes help people find the existing terminal tools; they do not by themselves establish working market data or a personal shortlist worth revisiting.

This wave addresses three subsequent adoption obstacles:

1. **“What should I set up?”** A persistent Getting Started page offers a goal, real provider readiness and watchlist creation without a mandatory tour.
2. **“How do I bring my shortlist?”** Reviewed symbol import and keyboard watchlist traversal reduce repeated manual work.
3. **“Can I trust these prices?”** Data-quality reporting distinguishes process availability, provider availability, observed symbol freshness and the session assumptions behind a bar expectation.

This is a progression from discovery to useful setup and repeatable review. It is not a new market-data entitlement, automatic broker connection, verified global exchange calendar or institutional terminal replacement.

## Verified competitor patterns

Only public primary documentation was used. Product entitlements can vary. There was no paid-account hands-on evaluation, and vendor descriptions are not performance measurements.

| Product and official reference | Verified pattern | Lesson for OpenTerminalUI | Boundary |
| --- | --- | --- | --- |
| TradingView: [watchlist import/export](https://www.tradingview.com/support/solutions/43000487233-how-to-import-or-export-a-watchlist/) | Its documented TXT format uses exchange-qualified, comma-separated symbols; export is available from Advanced view | Migration formats need explicit adapters and an inspectable preview | Generic CSV support does not automatically mean full TradingView export compatibility. |
| TradingView: [watchlist advanced view](https://www.tradingview.com/support/solutions/43000771546-watchlist-advanced-view-mode/) | A dedicated advanced watchlist view extends the compact list into a richer analytical surface | Keep compact review fast, then allow deliberate deeper inspection | Existing OpenTerminalUI table/heatmap modes are not an equivalent configurable advanced-view implementation. |
| Bloomberg: [Terminal Essentials: IB, Worksheets and Launchpad](https://professional.content.cirrus.bloomberg.com/professional2023/insights/technology/bloomberg-terminal-essentials-ib-worksheets-launchpad/) | Guided learning explains real-time worksheets and customizing a Launchpad layout | Help should lead into a working workspace rather than end at a list of features | Copying a dense layout does not supply Bloomberg data, communications or execution coverage. |
| Koyfin: [My Views](https://www.koyfin.com/help/my-views/) and [table-view and portfolio import](https://www.koyfin.com/help/release-notes/v3-28-table-views-portfolio-import/) | Reusable table settings reduce repetitive setup; table views can be imported from other watchlists, and portfolio CSV import includes more than ticker membership | Treat reusable analysis views and data migration as separate capabilities | This wave imports symbol membership, not quantities, cost basis, purchase dates or custom reusable column sets. |
| LSEG: [Workspace quick-start guide](https://www.lseg.com/content/dam/lseg/learning-centre/documents/workspace-quick-start-guide.pdf) and [migration quick start](https://www.lseg.com/content/dam/lseg/learning-centre/documents/eikon-to-workspace-migration-quick-start-guide-english.pdf) | Role-tailored starting pages, Getting Started/help entry points, bookmarked instrument parameters and layout migration support | Make guidance revisitable, contextual and compatible with existing work | A local checklist is not an enterprise entitlement/migration assistant. These official guides include older publication dates; they verify the documented pattern, not every present-day control. |
| OpenBB: [preconfigured Apps](https://docs.openbb.co/workspace/analysts/apps) | Purpose-specific templates combine widgets, linked parameters, prompts and agents | Start from an analytical purpose and preserve context between relevant panels | Linking a symbol across routes is narrower than fully synchronized widget parameter schemas. |

The inferred adoption principle is consistent across these references: reduce setup work while keeping users aware of the instrument, source and scope of their analysis. That principle informs the changes below; it is not a claim that competitor users have validated this implementation.

## Existing capabilities versus new behavior

| Area | Already present before this wave | New code in this wave | Remaining gap |
| --- | --- | --- | --- |
| Workflow discovery | Workflow Hub, persona/task filtering, symbol continuity, pinned/recent tools | Getting Started is reachable from navigation, Home and the `SETUP`/`ONBOARD` command path | No measured activation baseline or automatic recommendation engine. |
| First-session guidance | Role presets, provider settings and individual analytical tools | Five goals with a specific next action; actual watchlist/provider status; manual research confirmations | Manual confirmations are self-reported, not proof of completed analysis. |
| Personal setup state | Existing persisted terminal settings | Goal and research-confirmation preferences keyed by authenticated account in this browser; storage-failure feedback | No cross-device onboarding synchronization. |
| Watchlist creation | Existing watchlist API and manager | Create the first watchlist directly from setup, show request state/errors, refresh cached lists | No automatic security-resolution or portfolio conversion. |
| Bulk shortlist import | Individual add/remove and existing exports | TXT/CSV file or paste input, bounded parsing, row preview, syntax diagnostics, duplicate/existing detection and explicit confirmation | Listing existence, feed coverage and canonical instrument identity are not verified by the parser. |
| Watchlist navigation | Table/heatmap views, symbol context actions and quote updates | Roving row focus, arrows/Home/End, Enter/Space to Security Hub, keyboard context menu and persisted sorting | Arrow movement changes focus; it does not yet provide a continuously linked chart-and-fundamentals split view. |
| Data health | Provider status endpoint, US stream quality monitor and operations panel | Dashboard composes provider status and observed feed reports, with partial/error/empty states | Provider-wide health is not a per-symbol entitlement test. |
| Session expectations | A fixed US weekday 04:00–20:00 assumption in quality calculations | Venue-aware regular/extended cash sessions, cash NSE/BSE and continuous crypto support through explicit metadata; closed/unknown/no-data states | Production quality collection remains attached to the US stream, not automatic all-market ingestion. |
| Calendar transparency | Bundled holiday file and shared calendar helpers | Source, supported-year coverage, local timezone/date, session scope/state and explanatory notes in reports/UI | The bundled calendar is limited and is not a live certified exchange schedule. |
| Missing-data semantics | Received/expected bar counters and stored gap observations | Nullable unknown expectations and session-to-date deficit aggregation | A deficit can reflect a sparse trade-generated stream; it is not automatically proof of provider data loss. |

### Implementation references

- Setup: `frontend/src/pages/GettingStarted.tsx`, `GettingStarted.css`, `frontend/src/data/onboarding.ts`.
- Reviewed import: `frontend/src/utils/watchlistImport.ts`, `frontend/src/components/watchlist/WatchlistImportPanel.tsx`.
- Watchlist interaction: `frontend/src/components/watchlist/WatchlistManager.tsx`.
- Data-trust presentation: `frontend/src/api/dataQuality.ts`, `frontend/src/pages/DataQualityDashboard.tsx`, `frontend/src/components/ops/DataQualityPanel.tsx`.
- Session implementation: `backend/services/quality_calendar.py`, `data_quality_monitor.py`, and explicit US regular-session initialization in `us_tick_stream.py`.

## UI/UX options considered

| Option | Interaction model | Advantages | Costs |
| --- | --- | --- | --- |
| Mandatory first-run wizard | Block the terminal until market, provider and initial workspace are chosen | Clear sequence and predictable first-run path | Delays returning/importing users; can imply keys are mandatory; unreliable if a provider is temporarily down. |
| Revisitable setup workspace | A normal route with a goal-specific next action, readiness checklist and real setup operations | Users can skip, return, change goals and recover from provider failures without losing work | Requires clear entry points and honest distinctions between observed status and self-reported completion. |
| Fully contextual guidance | Inline recommendations on each watchlist/chart/research page | Advice appears at the moment it is needed | Easy to scatter contradictory checks, duplicate configuration and create notification clutter. |

The implemented choice is the revisitable setup workspace, supported by inline import review and a dedicated data-trust page. It builds on the previous Workflow Hub instead of replacing expert workspaces. Contextual assistance is a next step where a specific missing capability prevents an action. A full-screen mandatory tour is unnecessary for an existing feature-rich terminal.

Use the existing palette, controls and density settings. Favor semantic labels, visible focus, textual statuses and local scrolling for dense tables. Small screens should retain the task, current account/context and a usable next action. An amber warning should identify what is uncertain; a green badge must not stand in for evidence that a particular security has fresh, entitled data.

## Exact delivered boundaries

### Getting Started

The page filters provider status to the selected market/region and global sources. A healthy provider must be configured and report `ok`; configured credentials alone are insufficient. Failure to load status remains an error state. Source health does not guarantee every listed capability, security or session.

Watchlist readiness comes from actual API records and supports actual creation even when default/existing lists are available. An automatically seeded default list is described as available, not evidence that the user personally created a shortlist. The company-inspection and saved-research checklist steps are deliberately manual confirmations. Goal and confirmations persist only for an identified account in the current browser. Without an account identifier they last for the visit; blocked storage is explained to the user. Choosing a goal changes the recommended route, not the market or user's whole workspace.

### Symbol import and repeatable watchlist review

Import accepts the documented newline symbol format and header-based CSV with one `symbol` or `ticker` column. An optional `exchange` column supports NSE, BSE, NYSE and NASDAQ. Explicit qualified symbols and `.NS`/`.BO` suffixes are preserved; exchange conflicts are rejected instead of guessed. Parsing supports quoted fields, common delimiters and BOM/CRLF input. Limits are 64 KiB, 500 nonempty rows and 40 characters per symbol.

Rows are labeled ready, duplicate, already present or invalid. Preview is syntax review, not security validation. Confirming sends only reviewed ready symbols through the existing add-symbol API; other rows are skipped. Pending requests prevent repeated confirmation and changing the target watchlist; failures retain the review for retry. This does not establish server-side idempotency under every concurrent edit or cross-tab race.

Native TradingView TXT compatibility is implemented as a qualified-list subset, separately from generic CSV: comma-separated tokens must carry explicit exchange prefixes, such as `NASDAQ:AAPL,NASDAQ:MSFT,NSE:RELIANCE`. A mixture of qualified and bare tokens remains an ambiguous format and is rejected. `###` section markers appear as skipped non-symbol rows; the importer does not recreate section grouping. Explicit prefixes are preserved syntactically, not mapped or certified against every provider. Complete exchange aliases, futures, FX and listing coverage still require separate verification. The parser test cases include the qualified-list, mixed-qualification rejection and skipped-section behaviors; the final QC report owns their execution outcomes.

Watchlist rows now support keyboard traversal and opening the focused security, plus sorting by saved choice. The sorting preference uses the existing browser-level watchlist sort key, so it is not yet account-specific. This is distinct from named, reusable table views or Koyfin-style column configurations.

### Session-aware data trust

The dashboard loads `/providers/status` and `/ops/data-quality` independently. If one source fails it reports partial coverage; if both fail it shows an error. An empty monitor does not mean zero missing data or working live feeds. Provider names/statuses, observation time, per-symbol freshness and session metadata remain separate.

The monitor's additive fields are `market`, `session_scope`, `session_state`, `timezone`, `session_date`, `session_open`, `session_close`, `calendar_source`, `calendar_coverage` and `calendar_note`. Unknown bar expectations are `null`, not zero. Health can be `closed`, `unknown` or `no_data`, alongside healthy/degraded/stale/disconnected. The UI exposes closed and unknown sessions separately from feeds needing attention.

**Production scope:** the real quality monitor is still owned by `USTickStreamService`. It explicitly monitors **US regular cash-equity session expectations**. Extended ticks can still stream, but they do not become expected regular-session bars. The monitor supports explicitly requested US extended scope as a consolidated 04:00–20:00 assumption; the scope and note must travel with results. This is not a new extended-hours subscription or proof of venue-specific entitlement.

**India and crypto:** the monitor supports NSE/BSE cash sessions and 24/7 crypto when supplied suitable symbols/explicit metadata. Adding that logic does not automatically connect Indian or crypto feeds to the production monitor. Bare ambiguous symbols remain unknown rather than being confidently assigned a US calendar. NSE/BSE normal cash assumptions must not be applied to equity derivatives, NFO/BFO, special/Muhurat trading, or unrelated venues.

**Calendar coverage:** full holiday entries are reused from `data/holidays.json` through the shared calendar. The currently bundled entries cover 2026; this implementation does not verify every Indian holiday or continuously refresh exchange announcements. Unknown years return unknown expectations. US 2026 regular-session early closes on November 27 and December 24 use 13:00 ET, with an explicitly labeled 17:00 extended-hours assumption. Sources: [NYSE hours/calendar](https://www.nyse.com/trade/hours-calendars), [NYSE 2026 calendar](https://www.nyse.com/publicdocs/nyse/ICE_NYSE_2026_Yearly_Trading_Calendar.pdf), [Nasdaq holiday hours](https://www.nasdaq.com/holiday-trading-hours), and [NSE normal market timings](https://www.nseindia.com/static/market-data/market-timings). Unscheduled closures and special sessions remain unsupported.

Counters follow the venue-local session day, deduplicate minute bars and exclude bars outside the selected session. Normal equity overnight closures do not create false missing-bar gaps; crypto midnight resets daily counters while retaining continuous gap detection. Staleness is evaluated inside the relevant session with opening grace, and crypto receives no artificial midnight grace. A disconnected provider stays disconnected even if its exchange is closed. None of this certifies fills, order-book depth or trading readiness.

## Prioritized next features

S/M/L are relative implementation sizes, not delivery estimates. This backlog is intentionally narrower than the first-wave platform roadmap and focused on useful activation and reliable repeated review.

| Priority | Feature | Concrete acceptance criteria | Main dependency / size |
| --- | --- | --- | --- |
| P1 | Complete native shortlist adapters | Each supported vendor format has representative fixture imports, preview round-trip and explicit unsupported sections/venues; never silently reinterpret portfolio columns | Import parser/format selector, instrument mappings; M |
| P1 | Resolve imported instruments | Preview distinguishes syntax accepted, listing verified, ambiguous identity and unavailable coverage; user chooses exchange where needed | Canonical instrument service and provider search; L |
| P1 | Per-task capability readiness | A chosen workflow shows which actual data capabilities it needs, their available sources and useful setup links; generic healthy news source cannot mark price access ready | Provider capability contract; M |
| P1 | Populate non-US quality monitoring | Real NSE/BSE/crypto source adapters call monitor with verified market/asset/session metadata; tests assert source coverage in production reports | Existing real feed integration and identity; M/L |
| P1 | Maintainable verified calendars | Calendar records retain source, update date, year coverage and exceptions; unsupported years/special sessions do not silently become normal weekdays | Exchange-calendar data pipeline; L |
| P1 | Distinguish sparse bars from lost feed | Trade-generated bar deficits are labeled expected coverage, while sequence gaps/data loss have separate evidence; illiquid symbol fixture does not falsely accuse a provider | Provider/bar-generation metadata; M |
| P1 | Session/entitlement selection | User can inspect supported scope per source; changing regular/extended resets expectation counters and never claims data entitlement from preferences alone | Provider entitlement metadata and monitor configuration; M |
| P1 | Account-scoped watchlist preferences | Account switch cannot carry another user's sort/column preferences; safe migration retains prior personal choice when ownership is established | Auth lifecycle and preference storage; M |
| P1 | Server import receipt/idempotency | A client request ID identifies each import; repeating the request cannot duplicate side effects; response reports accepted/rejected symbols | Watchlist bulk API and transactional membership handling; M |
| P2 | Reusable watchlist views | Name/save/copy column set, sort, widths and currency; switching watchlists can reuse a view without changing membership | Column configuration model and UI; M |
| P2 | Linked keyboard research pane | Arrow traversal updates selected chart/fundamentals in a split view; focus remains in list; changes preserve canonical instrument identity | Watchlist selection and workspace linking; M |
| P2 | Guided first verified security | From setup, choose a resolved security and load an observed quote with source/delay timestamp; unavailable source offers recovery instead of simulated success | Search, capability readiness, Security Hub; M |
| P2 | Evidence-based checklist completion | Automatically mark dossier/evidence creation only after persisted action; retain manual override clearly labeled; account switch rechecks ownership | Dossier/watchlist APIs and setup task state; M |
| P2 | Import correction/export | User can download invalid rows with reasons and accepted rows separately; export safely escapes text and does not imply verified listing identity | Review/export utilities; S/M |
| P2 | Watchlist morning review | Brief states time window and source coverage, connects changed symbols to real evidence and preserves selected watchlist | News/events/filings plus task session; M |
| P2 | Actionable provider recovery | Distinguish unconfigured, rate-limited, unsupported symbol, disconnected and expired credentials; route to the relevant supported repair action | Provider error taxonomy; M |
| P2 | Bounded monitoring history | Status transitions, session openings and recovery retained with timestamps; stale alerts deduplicate across restarts if operationally required | Durable health/alert storage; M |
| P2 | Mobile review polish | Setup/import/watchlist/data-trust paths work at 390px and zoom; dense tables scroll within their region; row actions remain keyboard/touch accessible | Browser/device verification and shared components; M |
| P2 | Task-aware help | Context links explain why a calendar is unknown or an import row failed; guidance is searchable and does not require leaving the current task | Help content and error identifiers; S/M |
| P2 | Local activation instrumentation | Versioned optional counters measure setup→import→verified tool use; no research text, holdings or credentials collected | Explicit analytics/consent policy; M |
| P3 | Cross-device preferences | Goal/views/checklist sync per authenticated account with version/conflict behavior; offline browser state remains explainable | Owned preferences API; L |
| P3 | Assisted migration package | Import vendor list + map identities + preview reusable view + create workspace; retain an audit summary and clear unsupported items | All adapter, identity and layout capabilities above; L |

## Adoption KPIs without invented baselines

Establish baselines on a defined population before setting targets. Segment results by market, goal, provider availability and fresh/returning account. Do not infer increased adoption merely because new routes exist.

| Metric | Operational definition | Interpretation guard |
| --- | --- | --- |
| Setup-to-use activation | Share of first setup visits that create/reuse a watchlist and open a supported analytical view | Opening a page alone is not successful analysis. |
| Time to observed useful data | Time from setup entry to a selected security displaying an observed source and timestamp | Exclude simulated/sample data and report unavailable-provider sessions separately. |
| Import completion | Reviewed imports followed by successful confirmed mutation, divided by reviews with ready rows | Track network/server failures separately from syntax rejection. |
| Migration resolution rate | Imported identities verified unambiguously, divided by imported symbols submitted for resolution | Not measurable as “verified” until an actual identity resolver exists. |
| Repeat shortlist review | Accounts returning to a saved watchlist within seven days | Distinguish retained membership from ongoing meaningful review. |
| Keyboard efficiency | Steps/time from focused row to target security review under controlled task testing | Avoid recording raw key streams or treating keyboard preference as universal. |
| Trust diagnostic success | Data-trust visits followed by resolving a specific provider/session problem | Merely viewing the dashboard does not prove improved data quality. |
| Unknown-calendar exposure | Monitored rows with unknown session/coverage divided by monitored rows | Decreasing it by guessing calendars is a failure, not progress. |
| Closed-session false alerts | Stale alerts fired for known closed sessions | Deterministic regression target is zero for covered fixture scenarios; production baseline still needed. |
| Checklist evidence quality | Automatically evidenced completed tasks versus manual confirmations | Keep the two categories visible rather than reporting both as verified activation. |

Prefer local counters and opt-in diagnostics. Remote telemetry requires its own consent and retention decision. Do not collect security research text, portfolios, document contents, provider keys or detailed keystrokes for these measures.

## Direct verification completed for the backend session work

The following command passed **60 tests**, with one existing Starlette/httpx deprecation warning, in **5.70 seconds**:

```bash
.venv/bin/python -m pytest \
  backend/tests/test_venue_data_quality.py \
  backend/tests/test_market_calendar.py \
  backend/tests/test_data_quality.py \
  backend/tests/test_ws/test_ws_us_quotes.py \
  backend/tests/test_ws/test_marketdata_hub_candles.py \
  backend/tests/test_marketdata_hub_bookkeeping.py \
  backend/tests/test_providers_status.py \
  backend/tests/test_provider_registry.py \
  backend/tests/test_reports_market_status.py -q
```

Scope: deterministic US/NSE/BSE session boundaries, weekend/full-holiday behavior, 2026 US early closes, DST offset changes, unknown venues/years, explicit regular/extended scopes, local-day and UTC-midnight bar counting, continuous crypto midnight gaps, late/duplicate bars, per-venue stale-alert suppression/deduplication, metadata/reporting, and existing streaming/provider/report regressions.

These results do not certify live vendor feeds or the completeness of the bundled holiday dataset. Frontend source/test inspection informed this report, but final frontend/browser outcomes belong in the release QC report. Historical legacy experiment rows remain a separate first-wave limitation; this wave does not remediate their stored fabricated metrics or add a real legacy execution engine.
