# Watchlist Review Desk: repository analysis and terminal feature plan

Analysis date: **15 November 2026**. Baseline: **`9756252`**. This document describes the current implementation relative to that baseline and separates it from the proposed roadmap. Final browser evidence, whole-repository test results and release decisions belong in the release QC report, not in this planning document.

## Product decision

Build the next adoption improvement around a saved shortlist: **select an instrument, inspect its chart and quote context, record a note, and choose the next instrument without repeatedly leaving the watchlist**.

The repository already has substantial analytical breadth. Its main opportunity is to connect those capabilities into repeatable work, reduce repeated configuration, preserve instrument identity and make unavailable data understandable. Adding another general dashboard or copying the density of an institutional terminal would not address that problem. This is an inference from repository inspection and the documented competitor workflows below; no adoption increase has yet been measured.

The implemented package extends the existing watchlist route with a Review mode. It does not replace the table, heatmap, Security Hub, Launchpad or research dossiers. It also does not supply new exchange entitlements, historical execution data or broker certification.

## Repository structure and current capabilities

### Architecture

| Layer | Existing implementation | Implication for this wave |
| --- | --- | --- |
| Application shell | React 18, TypeScript and Vite; protected route families in `frontend/src/App.tsx`; shared terminal shell, command routing and navigation | Add an entry point to an existing tool and reuse the shell rather than introduce a parallel application. |
| Client state and requests | TanStack Query for remote data; Zustand and browser stores for preferences, quotes and workspace state | Separate account-owned server notes from browser-only display/status preferences; isolate cache keys and drafts by account and instrument. |
| Market data | FastAPI routes, provider adapters and services for Yahoo, FMP, Finnhub, NSE and broker integrations; REST snapshots and quote-stream stores | Reuse available data, retain provenance, and represent missing values explicitly. A process reporting healthy is not evidence that a particular symbol has a fresh quote. |
| Persistence | SQLAlchemy models and migrations; SQLite/PostgreSQL configuration; cache services | Existing owned notes can be reused. Cross-device review-status/preferences synchronization needs a separate model/API and is future work. |
| Research | Security Hub, filings/RAG, dossiers, evidence, research inbox/Today, agent tools and memory notes | A brief note in a review pane should feed existing research storage rather than create another disconnected notes system. |
| Analysis and execution workflows | Screeners, comparison, technical charts, portfolio/risk tools, Model Lab/backtesting, F&O analysis and paper/execution-related surfaces | Route to deeper tools deliberately; a selected commodity or crypto pair must not acquire stock-only actions by accident. |
| Verification | Backend pytest suites, frontend Vitest suites and Playwright flows; previous audit reports and screenshots | Add focused regressions for the new transitions and data semantics, then run the established whole-change checks. |

The previous strict audit recorded an 84-entry route inventory. This wave increases the usefulness of an existing route rather than adding another independent top-level analytical screen. That inventory is historical evidence, not a fresh claim that every existing financial calculation has been revalidated here. See [the prior strict audit](STRICT_QC_SECURITY_AUDIT_ROUND2.md).

### Existing features that should not be rebuilt

| Area | Already present at the baseline | Gap addressed now or retained for later |
| --- | --- | --- |
| Discovery | Workflow Hub, persona/task filtering, searchable tool catalog, pins/recents, GO commands | Discovery did not provide a linked shortlist review surface. |
| First-session guidance | Getting Started, provider readiness, watchlist creation and clearly labeled manual research confirmations | A setup checklist is not evidence of completed research or a measured activation funnel. |
| Watchlists | Owned membership API, creation/removal, TXT/CSV review, exchange-qualified TradingView TXT recognition, duplicate checks, table/heatmap modes, keyboard row traversal | Keyboard traversal previously changed focus; opening research navigated away from the list. Import syntax checks still do not prove canonical listing identity or feed coverage. |
| Workspace flexibility | Launchpad, panel groups, symbol/date/currency context, layout import/export, undo and pinned artifacts | The existing portability parser already bounds files/panels, creates fresh imported IDs and strips sensitive property names. A new layout import/export system would duplicate existing work. |
| Saved work | Saved views, workspaces, dossiers and persisted agent notes | A full named watchlist-column-view library is distinct from saved application layouts. The new lightweight display presets do not claim that feature. |
| Daily review | Today/research inbox, cited event review, acknowledgment and snoozing | Avoid a second generic inbox. A future watchlist brief should connect to the existing review model. |
| Data trust | Provider status, observed-feed quality, session/calendar assumptions and prior provenance fixes | The review pane now carries selected-quote availability metadata; per-instrument entitlement/recovery diagnosis remains incomplete. |
| Research notes | `listNotes`, `addNote`, `deleteNote`, owned `AgentNote` records and Launchpad notes panel | Reuse the existing server API, scope caches by account, and preserve unsaved text while the selected instrument changes. |

Relevant earlier analysis: [competitive analysis](TERMINAL_COMPETITIVE_ANALYSIS.md), [second-wave adoption analysis](TERMINAL_ADOPTION_WAVE2_ANALYSIS.md) and [research workspace capabilities](RESEARCH_WORKSPACE_UPGRADE.md). Those documents contain broader historical plans; a listed roadmap item is not automatically delivered code.

## Current primary-source competitor research

Public documentation was opened and checked during this analysis. Documentation describes vendor functionality, not independently measured usability, performance or subscription entitlements. Publication dates are retained where visible: the Bloomberg Essentials article is dated October 2024, Koyfin's view guide was updated June 2024, and IBKR's linking guide was updated October 2025. Their current availability verifies the documented patterns, not a claim that every control is unchanged in every subscription.

| Product and verified source | Documented capability | Inference for this repository | Scope boundary |
| --- | --- | --- | --- |
| TradingView: [advanced watchlist view](https://www.tradingview.com/support/solutions/43000771546-watchlist-advanced-view-mode/) | Watchlist analysis includes multiple metric modes, earnings/dividends/news, grouping and list export. | A saved list can become a useful analytical surface rather than only a launch menu. | This wave implements linked review and a small price/volume column set, not TradingView's full metric catalog, aggregation or currency conversion. |
| TradingView: [symbol text notes](https://www.tradingview.com/support/solutions/43000667897-how-to-check-all-text-notes/) | Notes are associated with symbols; the documented interface can list symbols with notes and show note markers in a watchlist. | Preserve research observations next to the selected instrument. | Current OpenTerminalUI review status is a manual browser preference; it is not a synchronized TradingView-style flag system or an all-notes index. |
| Bloomberg: [Terminal Essentials, Worksheets and Launchpad](https://professional.content.cirrus.bloomberg.com/professional2023/insights/technology/bloomberg-terminal-essentials-ib-worksheets-launchpad/) | The vendor guide teaches real-time Worksheets and customizable Launchpad layouts alongside terminal communication workflows. | Keep a stable working surface and let users deliberately arrange connected analysis. | Reusing a pane layout does not supply Bloomberg market data, communications, execution or institutional coverage. |
| Koyfin: [Watchlist Views](https://www.koyfin.com/help/my-views/) | Reusable column/table configurations include sorting, grouping and currency settings, with manual/automatic saving and reuse in dashboards/screens. | Reduce repeated display setup, keeping membership separate from presentation. | The delivered presets are browser-local and limited to three numeric columns and row spacing. Named views, grouping, currency conversion and cross-device synchronization are future work. |
| IBKR: [color-grouped linked panels](https://www.ibkrguides.com/traderworkstation/color-grouping-linked-panels.htm) | Source/destination groups propagate instrument selection between panels and support separate groups. | Make the selected instrument explicit, then update dependent content without discarding list focus. | A linked chart is not a broker connection or an executable order ticket. This wave does not certify orders or market-data entitlements. |

The shared lesson is an interaction pattern: list selection should carry a clear instrument context into a useful next view. The product should retain its own restrained hierarchy and self-hosted workflow rather than reproduce a competitor's visual density.

## UI/UX options considered

| Option | Advantages | Costs and failure modes | Decision |
| --- | --- | --- | --- |
| Navigate to Security Hub for every row | Reuses all existing company tools; simple mental model | Repeated navigation interrupts a shortlist review, and non-equities need different destinations | Retain as the explicit deep-research action and preserve the existing table behavior. |
| Expand a chart and notes inside every row | Keeps research near a row | Several expanded rows produce a long, hard-to-scan document; keyboard/focus behavior becomes complicated | Do not make this the default. |
| One linked preview beside the watchlist | One stable selection; list remains available; small-screen layout can stack deliberately | Requires careful handling of filtered/removed selections, request races and unsaved drafts | Implement as opt-in Review mode. |
| Open a separate preview window | Useful for experts with multiple monitors | Popup/focus management and cross-window identity make first use harder | Existing Launchpad/popouts remain available; richer desk-to-popout linking is future work. |
| Replace the watchlist with a full multi-panel workstation | Many simultaneous metrics | Duplicates Launchpad and obscures the basic review task; increases data requests and visual load | Do not replace existing list modes. |

The chosen layout follows [PRODUCT.md](../PRODUCT.md): progressive depth, scan before configuration, efficient tables, clear next actions and accessible controls. Table settings are collapsible. One selected-instrument pane owns its chart, quote context and notes. Text labels accompany status; market direction and workflow state do not depend on color alone. On a narrow viewport the preview can follow the list, with an explicit jump action rather than forcing the entire page to scroll sideways.

## Delivered implementation and exact limits

### Linked review and deeper actions

- Review mode is part of `/equity/watchlist`, alongside the existing table and heatmap modes. List filtering, selected-symbol context, previous/next controls and keyboard traversal connect the shortlist to one preview.
- The selected instrument has a visible name/context, quote summary, price-history chart and deliberate links to supported deeper tools. Company-specific actions are presented for equities rather than assumed for all symbol strings.
- Asset-aware routing recognizes supported commodity continuous-contract suffixes, crypto pairs, FX pair suffixes and known NSE underlying indices. Explicit listing qualifiers/suffixes take precedence over an unrelated desk market.
- Known NSE indices are labeled as underlying indices: their chart is not presented as dated futures-contract history. Continuous commodity symbols are likewise identified as continuous contracts.
- Shared symbol-context actions and crypto deep-link selection were corrected so a requested asset is not silently replaced by a different asset after asynchronous loading.
- `REVIEW`, its `REVIEWLIST` alias and supported symbol-scoped forms enter the review surface through the existing command system. This is a discovery path into an owned watchlist, not automatic creation of a new list or a guarantee that the requested symbol belongs to it.

### Notes, drafts and review status

- Research notes reuse the existing account-owned server API. Backend listing and deletion filter by the authenticated user's ID. Frontend query keys include account and symbol; account changes do not reuse another user's cached note view.
- Notes support the existing note/thesis types. The panel shows a bounded recent list and stores plain text rather than HTML. Failed saves retain the draft. It is not a new rich-text editor, revision history or unlimited notes search.
- Unsaved drafts remain in memory in the current tab, scoped by account and exact instrument string. They survive instrument switches. Up to 50 nonempty drafts of at most 2,000 characters are retained; capacity errors are explicit, with no silent eviction. Empty note-type choices do not consume a draft slot. A page refresh or closing the tab can lose unsaved drafts; server persistence occurs only after Save note succeeds.
- Query and mutation requests receive cancellation signals tied to their context. Pending work from a prior editor cannot clear the new instrument's draft or display a stale save-success message there. Existing Launchpad notes also received account-scoped cache/lifetime safeguards.
- Review status has five manual states: Unreviewed, Watching, Researching, Ready for review and Archived. It can label/filter the shortlist. Ready for review is a human workflow label, not a trading recommendation, execution instruction or automatically verified research result.
- **Review status is saved only in browser storage, scoped to the signed-in account and symbol.** It is not stored in the server notes model or synchronized across devices. Corrupt/oversized stored status and storage failures produce explicit feedback.

### Reusable table settings and quote honesty

- Price focus and Price and volume presets configure last price, percentage change and volume columns. Users can also select custom visibility and compact/comfortable row spacing. Symbol/actions remain available.
- **Display settings are browser-local per signed-in account.** They do not change list membership, create named server views or synchronize to other devices. Unreadable settings fall back with a warning; quota failures preserve working in-memory choices for the visit.
- Quote responses retain backward-compatible numeric fields and add availability/context metadata: `change_available`, optional provider-reported `currency` and `timestamp_source` (`reported`, `retrieved` or `adapter`). Retrieval time is not recast as an exchange timestamp.
- The review surface distinguishes unavailable change/volume/currency/time from actual observed values. It does not infer missing currency from the currently selected desk or estimate missing numbers. A provider response or connected process does not establish freshness by itself.

### Main implementation references

| Area | Files |
| --- | --- |
| Review integration | `frontend/src/components/watchlist/WatchlistManager.tsx`, `WatchlistReviewPane.tsx`, `WatchlistReview.css`, `reviewInstrument.ts` |
| Owned notes and local status/drafts | `frontend/src/components/watchlist/InstrumentNotesPanel.tsx`, `frontend/src/store/instrumentNotesStore.ts`, `frontend/src/api/agentExtras.ts`, existing `ResearchNotesPanel.tsx` |
| Local display preferences | `frontend/src/store/watchlistViewStore.ts`, `frontend/src/components/watchlist/WatchlistViewSettings.tsx` |
| Commands and discovery | `frontend/src/components/layout/commanding.ts`, existing tool/workflow navigation integration |
| Asset navigation | `frontend/src/components/common/SymbolContextMenu.tsx`, `frontend/src/pages/CryptoWorkspace.tsx` |
| Availability metadata | `backend/api/routes/quotes.py` and the review quote adapter/consumer |

## Prioritized feature matrix

**P0** below identifies this wave's delivered code, subject to the separate QC results. **P1/P2 are proposals, not implementations.** Acceptance checks are required outcomes for each item; their inclusion is not a claim that future tests have run. Effort bands are planning estimates for an experienced contributor after dependencies are available: S = roughly 1–3 engineering days, M = 4–10 days, L = 2–4 weeks, XL = more than 4 weeks. Licensing, provider contracts and deployment operations can add substantial time. Estimates do not describe the elapsed time or cost of the present implementation.

| ID / priority / state | Capability and user benefit | Actual dependencies | Acceptance checks | Effort estimate |
| --- | --- | --- | --- | --- |
| R01 · P0 · Delivered | Linked watchlist review reduces repeated page changes while screening a shortlist. | Existing watchlist membership/quote APIs, chart component, selection and keyboard state. | Selecting/arrowing AAPL→TCS changes preview without leaving the list; filtering/removing the selection chooses a valid visible fallback or an explicit empty state. | M |
| R02 · P0 · Delivered | Asset-aware context prevents unsupported stock actions from being offered for commodities, FX, crypto and indices. | Explicit symbol qualifiers/suffixes, known-index mapping and existing asset routes. | GC=F, BTC-USD, EURUSD=X, NSE/NASDAQ-qualified stocks and NIFTY open the intended asset view; unsupported data is not substituted with another instrument. | M |
| R03 · P0 · Delivered | Owned server notes plus retained drafts connect observations to the instrument being reviewed. | Existing AgentNote ownership and APIs; account/symbol cache keys; bounded draft store; cancellation. | AAPL draft survives AAPL→TCS→AAPL; failed save retains text; account switch shows no prior user's notes; a prior save cannot clear TCS text. | M |
| R04 · P0 · Delivered | Manual review status and filters distinguish where to spend attention. | Account/symbol browser storage and visible status controls. | Status persists in the same account/browser, updates the list after save and remains separate across accounts; quota/corrupt-state errors do not claim success. | S |
| R05 · P0 · Delivered | Local column presets/density reduce repeated display adjustments. | Existing numeric columns and versioned browser preference store. | Price focus hides volume; custom choices and spacing survive reload for that account; settings do not alter membership; invalid data gives a recoverable warning. | S |
| R06 · P0 · Delivered | Quote availability/time/currency context makes the displayed numbers interpretable. | Provider adapters, backward-compatible quote wire contract and review consumer. | True zero change stays zero; missing change is unavailable; provider currency is retained; retrieval time is labeled distinctly from reported time. | M |
| R07 · P0 · Delivered | REVIEW commands and existing navigation make the new workflow discoverable to keyboard and pointer users. | Existing command parser, catalog and watchlist query parameters. | Supported command forms enter Review mode; invalid/unsupported input does not invoke trade actions or fabricate membership. | S |
| R08 · P0 · Delivered | Account and request-lifetime boundaries protect research during fast context changes. | Auth context, owned note API, account-scoped queries, abort signals and existing notes panel. | Signed-out notes make no requests; pending old requests are canceled on context removal; cached private data and success banners do not cross accounts. | M |
| R09 · P1 · Proposed | Canonical instrument resolution makes imported lists safer to reuse across markets. | Existing search/catalog adapters, exchange-qualified import preview, instrument identity schema. | Ambiguous AAPL/RELIANCE-style input requires an explicit listing choice; qualified identities round-trip; unsupported contracts remain unresolved with reasons. | L |
| R10 · P1 · Proposed | Per-instrument capability diagnosis gives users a supported recovery path when data is missing. | Structured provider errors, entitlement/capability metadata and current data-quality/settings routes. | Distinguish unconfigured, expired, rate-limited, unsupported and temporarily unavailable states; every recovery link corresponds to an actual supported action. | M–L |
| R11 · P1 · Proposed | Resumable workflow sessions retain progress and a concrete next research action. | Workflow catalog, owned session model, dossier/experiment artifact IDs and revision tracking. | Reopen the same symbol/session after reload; persist actual artifact receipts; manual checks remain labeled manual; an opened route alone cannot mark research verified. | L |
| R12 · P1 · Proposed | Owned cross-device preference sync lets users resume statuses/views on another browser. | New owned preference API/model, schema versions, conflict handling and offline recovery. | Two devices converge without silently losing edits; account switch cannot reuse another user's state; local-only versus synchronized state remains visible. | L |
| R13 · P1 · Proposed | Named analytical table views provide deliberate reusable configurations beyond the three current numeric columns. | Column metadata registry, widths/order model, resolved identity and owned persistence. | Save/copy/rename a view without changing membership; apply it to another list; unsupported fields remain visibly unavailable; no mixed-currency total is implied. | M–L |
| R14 · P1 · Proposed | Watchlist-scoped morning review brings relevant earnings, dividends, filings and news into one time-bounded brief. | Existing events/news/filings services and research inbox, deduplication and watchlist ownership. | Brief declares time window and source coverage; links to original evidence; partial data is disclosed; refreshing does not duplicate inbox actions. | L |
| R15 · P1 · Proposed | Notes revision history/edit recovery makes research changes inspectable. | AgentNote revisions or related revision model, optimistic concurrency and owned edit API. | Conflicting edits are surfaced; prior text can be inspected/restored; deletion/restore respects ownership; no HTML execution is introduced. | M–L |
| R16 · P1 · Proposed | An owned all-notes index improves retrieval after a shortlist grows. | Notes search/pagination API and canonical instrument metadata. | Search and paginate only the signed-in user's notes; results show exact symbol/type/date; deleted/foreign records cannot be retrieved by ID. | M |
| R17 · P2 · Proposed | Revocable read-only review packs let users share a bounded research context. | Existing dossier sharing patterns, explicit permission model, snapshot/export schema and retention policy. | Export/share includes only selected data; credentials and unsaved drafts are excluded; revoked links fail; editing is unavailable to read-only recipients. | L |
| R18 · P2 · Proposed | Reviewed bulk alert setup reduces repetitive monitoring configuration. | Existing alerts API, exact listing/currency context, rule preview and idempotency. | Preview every symbol/rule before creating alerts; no unsupported asset is silently converted; repeating a confirmed request cannot duplicate alerts. | M–L |
| R19 · P2 · Proposed | Review-to-Launchpad linking supports experts who want a second screen. | Existing panel color groups/popouts and explicit instrument/date/currency context. | Opted-in linked panels follow selection; unlinked panels remain unchanged; changing a list does not hijack an unrelated workspace. | M |
| R20 · P2 · Proposed | Frozen review receipts preserve what a user saw when making a research decision. | Versioned quote/source snapshots, note/artifact references and owned storage. | Receipt retains observed values, availability and time semantics; later market moves do not rewrite it; a review receipt is never represented as an executed trade. | L |
| R21 · P2 · Proposed | Usability studies and optional activation diagnostics establish whether the workflow improves adoption. | Task scripts, privacy/consent policy and minimal versioned event definitions. | Measure time/actions to inspect and record a real instrument; separate unavailable-data sessions; collect no notes, holdings, credentials or raw keystrokes by default. | M |
| R22 · P2 · Proposed | Large-list performance work keeps selection responsive as watchlists grow. | Rendering profiles, bounded subscriptions/request scheduling and possible row virtualization. | Test a defined large list under throttled network; old requests cannot overwrite new selection; virtualization preserves keyboard focus and accessible row semantics. | M–L |
| R23 · P2 · Proposed | Contract-level futures identity gives derivatives review the correct expiry, multiplier and rollover context. | Authoritative contract catalog, broker/public-feed availability, exchange calendars and explicit entitlements. | Dated contract history is distinct from underlying/continuous history; unknown lot sizes remain unknown; rollover rules and source dates are visible. | L–XL |
| R24 · P2 · Proposed | Broader accessibility, localization and timezone controls widen practical use. | Shared control system, date/number formatting policy, translations and real browser/device testing. | Keyboard-only and screen-reader review works; 200% zoom and 390px layout retain actions; saved timestamps remain unambiguous across timezones. No WCAG certification without a measured audit. | M–L |

R09–R16 follow the present desk because they improve identity, recovery and persistence before adding more simultaneous panels. R17–R24 depend on explicit user needs, reliable data contracts or measured performance/privacy decisions. This ordering is a product judgment, not a vendor-parity score.

## Functional and quality acceptance for the current release

The implementation should be checked with both controlled fixtures and available real provider data. Fixture success alone does not verify live feeds; a screen that stops loading is not proof that every interaction works.

1. **Instrument selection:** traverse a mixed watchlist by pointer and keyboard, change filters/sorts, remove a selected symbol, switch watchlists, and use browser back/reload. The displayed instrument must agree with the selected row and supported destination.
2. **Asset context:** inspect US/NSE-qualified stocks, commodity continuous contracts, crypto, FX and known index/futures entry points. Preserve venue distinctions and label underlying history explicitly.
3. **Request races:** make the previous instrument's responses arrive last. It must not replace the current chart, quote, notes or save feedback. Include pending save plus symbol/account switching and StrictMode effect cleanup.
4. **Drafts and ownership:** create, save, retrieve and delete only test-owned notes. Check AAPL→TCS→AAPL draft retention, account isolation, empty note-type choices, text limits and capacity behavior.
5. **Persistence:** test status/display preference reloads, a different account, corrupt JSON, oversized values, denied storage and quota exhaustion. A browser-only change must not be described as cloud-synchronized.
6. **Unavailable values:** test genuine zeroes, missing change/volume/currency/time, adapter/retrieval timestamps, partial provider failures and no data. Never fill gaps with random values or infer quote freshness from connection status.
7. **Accessibility and mobile:** verify labeled controls, visible keyboard focus, Enter/arrow behavior, preview jump action, table scrolling, pointer targets and the selected preview at a narrow viewport. Read critical labels without relying on colors.
8. **Regression gates:** run targeted regressions, the existing frontend/backend suites, production build, browser functional tests and diff checks. Record skipped or blocked checks separately; fix confirmed failures and repeat the affected checks.

## Adoption measures without invented outcomes

| Measure to establish | Operational definition | Interpretation guard |
| --- | --- | --- |
| Time to useful review | Time from opening a saved list to an observed selected quote/chart and a successfully saved note | Separate fixture/demo data and unavailable-provider sessions. |
| Navigation cost | Route changes and deliberate actions needed to inspect five specified instruments in a controlled task | Fewer clicks do not prove better research quality. |
| Review return rate | Users returning to an owned watchlist/review session within a defined period | Status changes or page opens alone are not completed analysis. |
| Draft recovery | Proportion of controlled context-switch tasks retaining the expected unsaved text | Test reload/tab-close limitations separately from instrument switching. |
| Data-understanding accuracy | Users correctly identifying currency, source, missing values and reported versus retrieval time | A provenance badge alone is not proof of comprehension. |
| Workflow conversion | Saved review notes that lead to a persisted dossier, evidence item or explicit supported next action | Preserve user choice; do not report “ready” manual flags as verified trades or investment outcomes. |

No baseline, lift, retention improvement or task-time reduction is claimed by this release. Instrumentation should be designed only after consent, retention and self-hosted privacy expectations are settled.

## Final QC correction to chart periods

Real-data visual verification found that the normalized provider could return years of FMP history under a six-month cache key. This release derives relative UTC bounds, clips provider and cached results, preserves explicit timestamps and refits charts after resizing. See the separate QC report for final request bounds, tests and screenshots.

## Limits and release boundaries

- Public competitor documentation is not a paid-account hands-on comparison or a statement of feature availability under every plan.
- The current review pane is intentionally narrower than TradingView's advanced watchlist metrics, Koyfin's named view system or Bloomberg/IBKR execution-connected workspaces.
- Syntax-qualified instruments and the explicit routing rules are not a universal security master. Unknown listings and dated derivatives still need authoritative resolution.
- Broker authentication, market-data licensing, exchange calendars and network/provider limits remain independent dependencies. A UI change cannot establish a working live connection or entitlement.
- The open Kite/Autobahn dependency risk from the prior security audit is not solved by this feature package. Refer to the security report and current dependency/QC evidence rather than inferring security clearance from new features.
- Notes are server-owned; unsaved drafts are tab-memory only; review statuses, sorting/display preferences and presets are browser-local as labeled. Clearing browser storage or using another device can therefore change the available local state.
- The feature analysis does not certify all existing routes, financial formulas, real-money execution or full accessibility conformance. The separate QC report records the actual tests, screenshots, failures, fixes and residual limits for this release.
