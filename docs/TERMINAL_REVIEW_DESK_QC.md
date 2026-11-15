# Watchlist Review Desk: QC and functional verification

Date: 15 November 2026. Baseline: `9756252`. Companion: [repo analysis and prioritized feature plan](TERMINAL_REVIEW_DESK_ANALYSIS.md).

## Scope and method

Three implementation/research agents worked with the root integrator: owned notes/statuses, reusable view settings, competitor research and independent asset/data QC. Changes were integrated into existing watchlists, chart/history hooks, command navigation and owned notes APIs. No new dependencies, data entitlements, real-money trades or deployment are part of this release.

Browser checks use the isolated local audit database, a specifically created six-symbol test list, development authentication and real provider requests. Each visited screen/action waits for pending screen API requests and visible loading states to finish, with a 90-second deadline. A settled request is not treated as evidence of a successful business result: assertions inspect the selected symbol, API result, saved record, chart window, actions and error state.

The mixed list contains AAPL, RELIANCE.NS, GC=F, NIFTY, BANKNIFTY and ETH-USD. Broad pre-existing regression suites complement these targeted checks. The prior audit's 84-route load inventory is historical baseline evidence; this release does not claim a new exhaustive test of every control on all those pages.

## Delivered behavior verified

- Selecting or arrow-focusing a row updates a persistent preview without leaving the shortlist. Filtering, sorting, switching named lists and deleting the selected member cannot leave another symbol's preview visible.
- Asset actions distinguish equities, continuous commodities, crypto, currencies and supported index/futures contexts. Stock-only order/fundamental actions are suppressed on non-equities. ETH deep links retain ETH through asynchronous market loading instead of substituting the default BTC row.
- Chart requests carry explicit market context. NSE one-month history stays daily; US one-month requests retain the existing supported intraday policy. Prior-symbol hover state resets and resizing refits the visible history.
- Saved notes use the existing server-owned API. Text drafts are bounded in tab memory, survive symbol switching, and cannot be cleared by an old instrument's save. Account/symbol cache keys, request abort signals and keyed editor lifetimes prevent stale cross-account/editor display.
- Review status, sort, presets, columns and spacing are account-scoped browser preferences. They do not claim cloud synchronization. Storage corruption/quota errors and unavailable note requests have explicit recovery.
- Quote availability metadata distinguishes a genuine zero change from an absent change, retains currency only when provided, and separates retrieval timestamps from reported timestamps. Missing, undated, wrong-market or older stream data cannot replace a newer valid snapshot price.
- REVIEW / REVIEW AAPL / AAPL REVIEW open the desk through the existing command parser. Workflow discovery includes the desk. A requested symbol outside the selected list is disclosed rather than silently represented by the first member.
- Narrow screens retain internal table scrolling and offer an explicit Jump to preview action. Notes and view controls have named, keyboard-operable inputs and focus states.

## Findings caught and corrected during QC

| Finding | Correction / regression evidence |
| --- | --- |
| Account-unscoped watchlist and existing notes caches | Account keys, mounted account-switch tests, abortable API queries; existing Launchpad notes were hardened too. |
| Losing drafts on rapid symbol switching, old-request success banners, StrictMode cancellation | Bounded account/symbol draft store, lifetime cancellation and pending-save/StrictMode tests. |
| Empty Thesis selections exhausting the draft limit | Empty kind-only selections no longer consume text-draft capacity; boundary test covers more than 50 such choices. |
| Named-list URL overriding an explicit list switch | Removed state synchronization race; kept unrelated query parameters; regression switches from Shortlist to Other. |
| Invalid/stale/wrong-market stream tick replacing a good snapshot | Positive finite price, timestamp and market checks; parameterized stream tests. |
| Primary quote failure preventing alternate-market fallback | Catch source failure independently; test confirms alternate request and correct preview market. |
| Missing change values arriving as fabricated numeric zero | Backward-compatible availability flag consumed by Review mode; backend and frontend tests distinguish missing versus actual zero. |
| Finnhub successful quote path referenced an undefined volume variable | Volume remains unavailable; successful quote branch is covered by new tests. |
| Stale chart hover/readout and viewport fitting | Reset hover by instrument/market/range; reject invalid times; refit after container resizing. |
| Cached long history returned for a shorter normalized period | Provider window handling and cache filtering corrected; exact-window regressions and live API comparison recorded with final evidence. |
| Crypto route ignored the requested symbol | URL-derived selection and explicit unavailable state; deep-link/filter/loading regressions. |
| Stock-only shared actions for commodities, FX, crypto and indices | Canonical asset-aware destinations, safe action filtering, preserved custom removal actions. |
| Global sorting preference crossed accounts | Per-account storage and updated persistence regression. |
| Review filter and table-setting controls were hard to distinguish precisely | Explicit accessible names for filter, preset and row-spacing controls. |

## Functional scenarios

The machine-readable [functional evidence](../output/playwright/review-desk/functional-results.json) records actual results, separate from the roadmap.

1. Create the isolated mixed watchlist; wait for quotes, history and notes.
2. Write an AAPL draft, select Gold and return; verify exact draft text remains.
3. Save the note through the UI and independently read the saved owned note from the API.
4. Save Researching status and verify list badge/filter updates.
5. Change view to Price focus and Comfortable spacing; reload and verify columns, status and saved note persist.
6. Filter by symbol and status, including a no-match state; verify no stale preview.
7. Open Reliance one-month history under NSE context; open NIFTY's futures workflow with an explicit underlying-history label.
8. Follow ETH into the crypto workspace; verify requested asset remains ETH.
9. Inspect the desk at 390×844; jump/focus the preview; assert no horizontal document overflow.
10. Simulate only the notes GET returning 503; verify unavailable/retry state and restore normal routing afterward.
11. Compare normalized chart API time bounds with the requested six-month window after the history fix.
12. Recheck final loaded screens and screenshots after fixes, without concurrent source/HMR changes.

## Automated verification

Final results: **1,784 backend tests passed, 76.94% coverage** (75% gate); **907 frontend tests passed across 171 files**; production build passed; **74 desktop/mobile tests passed, 10 skipped, zero failed**. Counts, build status and skipped-test names are stored in [verification.json](../output/playwright/review-desk/verification.json). They supersede intermediate runs.

Meaningful new regressions cover review selection/account isolation, column presets/storage failures, note ownership/drafts/lifetimes, history market/range behavior, asset actions, crypto context, quote availability/timestamps and command forms. Existing frontend, backend and desktop/mobile functional suites were also run. Skipped tests are explicitly counted and are not represented as passes.

## Evidence and demonstration

- [Final desk overview](../output/playwright/review-desk/review-overview.png)
- [Notes and status](../output/playwright/review-desk/review-desktop.png)
- [Mobile preview](../output/playwright/review-desk/review-mobile.png)
- [NIFTY context](../output/playwright/review-desk/review-nifty.png) and [observed dated contracts](../output/playwright/review-desk/nifty-futures.png)
- [ETH destination](../output/playwright/review-desk/crypto-eth.png)
- [Notes-service error](../output/playwright/review-desk/review-notes-error.png)

Open `/equity/watchlist?view=review` in the running app, choose a watchlist, or use the `REVIEW` command. No additional portfolio or paid-feed setup is required to use the review UI.

Final observed NIFTY futures evidence: November 25,175; December 25,335; January 25,478. Each displayed row matched its API quote. Snapshot timestamp: 2026-11-13T10:10:00Z, with the market closed during this review. The keyboard ArrowDown check switched the linked preview to Reliance without leaving the watchlist.

## Residual limits

- Generic quotes may be unavailable for NIFTY/BANKNIFTY even when underlying history or the dedicated futures page has data. The preview reports missing quotes; it does not fill prices from unrelated instruments.
- Continuous/underlying charts are not dated futures contract history. Currency/venue identity is not universally resolved, and unsupported pairs are not silently converted to another quote currency.
- Review statuses/presets are local to the browser/account, and unsaved drafts are tab-memory only. Server notes are separate.
- Provider rate limits, delayed snapshots, broker authentication and licensed coverage remain external dependencies. This release does not certify live execution.
- The previously reported Kite SDK/Autobahn dependency vulnerability remains open. This feature work is not a blanket security clearance.
- Production builds retain the existing large-chunk warning. This pass does not claim measured adoption improvement or WCAG certification.
- Implementation was validated locally before the requested commit to main. No deployment was performed; subsequent CI results are reported separately.
