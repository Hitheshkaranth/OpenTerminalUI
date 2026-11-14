# Strict QC and security audit — second pass

Date: 2026-11-14. Working baseline: main at `25163697b309c11ad9e9fcf14ee86b1aed0bb7e9`.

## Verdict

Confirmed application findings below were fixed and retested locally. Security approval remains conditional: the current Kite SDK requires Autobahn 19.11.2, which has two distinct known vulnerability identifiers. No incompatible dependency override was applied.

## Method and coverage

- Opened all 84 entries in the route inventory, including four saved portfolio/model records with real IDs.
- Waited for initial screen API activity and visible loading indicators to settle (90-second deadline per screen). All 84 settled; none had uncaught browser errors or document-level horizontal overflow at 1440px.
- Recorded HTTP failures, visible text, loading state, unnamed buttons, screenshots and timing. This is page-load coverage, not a claim that every button or financial formula in the application was validated.
- Checked AAPL financials; Gold (GC=F) → WTI crude (CL=F) → Gold selection; NIFTY expiry changes, Greeks and strike ranges; BANKNIFTY futures prices against the actual API; Flow call filters, keyboard expansion and five-day behavior.
- Inspected populated futures, Flow and commodities at 390px. Internal table scrolling remains intentional. Reduced the mobile derivatives context from four stacked fields to a two-column layout.
- Used an isolated audit database and local development authentication for page checks. Live order execution and authenticated broker streaming were not certified.
- Applied security, interface-audit and Playwright workflows. Existing SSRF, export, watchlist and authentication regression tests were included in backend verification.

## Findings fixed

| Severity | Finding | Correction and evidence |
| --- | --- | --- |
| High | Flow multiplied volume × latest price × 100 for every contract. These are neither exchange-correct multipliers nor executed premium turnover. | Premium is nullable and used only when explicitly supplied by the provider. Unknown premium is excluded from positive-premium filters, rather than converted to zero. Currency is explicit; NSE activity no longer displays invented dollar totals. Regression tests cover missing and reported turnover. |
| High | Flow generated backdated, decaying copies of the current snapshot and invented per-row event-time offsets. | Retained the provider timestamp; removed synthesized history. Five-day selection explicitly reports unavailable history and returns no fabricated time-series points. |
| High | Commodity futures service projected absent months, prices, volume and open interest; continuous-contract delivery dates were guessed. | Removed projection generation and old cache namespace. Only observed quotes are returned. Continuous contracts are identified explicitly and unreported expiries stay null. Frontend rejects old projected/synthetic points; fewer than two valid quotes produces an explanatory empty state. A regression test proves a single observed quote remains one quote. |
| Medium | Flow described cross-sectional heuristics as a 20-day comparison, and classified calls/puts as bullish/bearish executions. | Marked the calculation as a current-chain heuristic; rows have neutral sentiment and the UI presents call/put activity without inferring buying/selling direction. |
| Medium | Flow summary ignored symbol/type/premium/expiry context; selecting an expiry filtered a different, nearest-expiry snapshot. | Scoped API and query keys to filters and active contract expiry. Requested expiry is fetched before filtering. Tested a non-nearest expiry and matching summary count. |
| Medium | Python dependency vulnerabilities in 18 installed packages, including JWT and MCP libraries. | Added compatible security version floors; upgraded the environment; replaced python-jose with patched PyJWT and removed unused python-jose/ecdsa. Dependency resolver reports no broken requirements. The final scan leaves only the upstream Kite/Autobahn issue described below. |
| Medium | JWT verification did not require expiration, subject and token-type claims. | Required these claims while retaining a fixed HS256 allowlist. Tests reject missing/expired claims, unsigned tokens, wrong signatures and an unapproved algorithm for both normal and WebSocket authentication. |
| Medium | Yahoo HTTP exception strings could include authenticated URLs/crumbs in logs. | Logging now includes status codes or exception types without request URLs. A sentinel credential test verifies redaction. |
| Medium | Broker adapter started a signal-installing reactor in its own worker thread. | Used the SDK's supported threaded connection mode. Regression test verifies the mode; authenticated broker connectivity remains unverified because credentials were rejected. |
| Medium | Forex batch-quote failure caused a 502 and labeled sample cross rates despite usable public chart prices. | Added a concurrent fallback to observed chart closes, preserving direct/inverse FX conversion. Browser retest loaded provider rates without the 502. Unit test covers failed batch quotes and all seven currency references. |
| Low | Five icon-only calendar/rotation controls lacked accessible names; Flow expansion required a pointer. | Named previous/next month controls, named the rotation playback and position controls, and added keyboard activation/expanded state to Flow rows. Browser recheck found zero unnamed buttons on audited pages. |
| Low | Earnings feed failure was indistinguishable from a valid empty calendar. | Added an explicit unavailable-data message. |
| Test infrastructure | Option-chain fixture depended on the invocation directory; Flow test asserted the former dollar formatting. | Resolved the fixture relative to the test module and updated the currency/provenance assertions. Full desktop/mobile suite was rerun, rather than dropping failures. |

## Verification

Final results are recorded in `verification.json` beside the browser evidence. Validation includes the full backend coverage gate, full frontend tests, production build, full desktop/mobile Playwright suite, targeted new security/data-integrity regressions, npm audit, Python dependency scan, and `git diff --check`.

The final full backend run passed **1,768 tests** with **76.72% coverage** (75% gate). All **839 frontend tests** passed; production build passed. The final full Playwright rerun, including the commodity/logging corrections, passed **74**, with **10 explicitly skipped** and **zero failures**. npm audit found zero vulnerabilities. Skips are not passes. The initial multi-timeframe search failure did not recur in targeted or full reruns; it is retained here as observed test instability.

## Remaining risks and limits

1. **Open dependency finding:** Kite Connect 5.2.2 pins `autobahn==19.11.2`. pip-audit reports `PYSEC-2020-25` and `PYSEC-2026-4027` (one duplicate advisory entry appears in scan output). Resolving a patched Autobahn alongside the SDK fails dependency resolution. A maintained SDK release/fork or a separately validated replacement transport is needed; silently overriding metadata is not a verified fix.
2. **Broker/live-data access:** Kite returned HTTP 403 and some providers returned entitlement/rate-limit failures during the broad suite. Public NSE snapshots worked; these are timestamped snapshots, not a certified live broker feed. No real-money orders were submitted.
3. **Missing research data:** AAPL analysis/knowledge/conviction endpoints return 404 until research records exist. Both Security Hub routes displayed explanatory empty states rather than crashing. These expected missing-record responses remain in the evidence.
4. **Static policy-rate snapshot:** The central-bank panel is explicitly labeled as a stale manually maintained snapshot. This audit does not supply a new licensed live policy-rate feed.
5. **Financial/provenance scope:** No historical execution-level options tape is available from the current chain feed. The UI now says so. Labeled demo fallbacks elsewhere are not certified market data.
6. **Performance:** Production build succeeds but retains a large-chunk warning. This pass did not benchmark bundle/network performance or certify WCAG conformance.
7. Changes were validated locally before the requested commit to main. No deployment was performed; subsequent CI results are reported separately.

## Evidence

- [Per-route results](../output/playwright/strict-audit-round2/loaded-pages-final.json)
- [Dependency before/after summary](../output/playwright/strict-audit-round2/dependency-audit.json)
- [Functional interaction results](../output/playwright/strict-audit-round2/functional-results.json)
- [Gold observed-only desktop](../output/playwright/strict-audit-round2/gold-observed-only.png)
- [Gold mobile](../output/playwright/strict-audit-round2/gold-mobile.png)
- [BANKNIFTY futures desktop](../output/playwright/strict-audit-round2/banknifty-futures-populated.png)
- [BANKNIFTY futures mobile](../output/playwright/strict-audit-round2/banknifty-futures-mobile.png)
- [Flow desktop](../output/playwright/strict-audit-round2/flow-retest.png)
- [Flow mobile](../output/playwright/strict-audit-round2/flow-mobile.png)

## Primary-source checks

NSE documents option-chain volume/open interest in contracts, so the old universal multiplier was not defensible: [NSE Option Chain](https://www.nseindia.com/option-chain). Provider execution turnover is distinct from latest price × cumulative contract volume.

JWT verification and migration were checked against the [PyJWT API reference](https://pyjwt.readthedocs.io/en/stable/api.html). Kite dependency compatibility was checked against the published package metadata and [official SDK releases](https://github.com/zerodha/pykiteconnect/releases).

## Route inventory and settled-load results

| Route | Instrument/context | Result |
| --- | --- | --- |
| `/home` | Saved record / page context | Settled |
| `/equity/stocks` | AAPL | Settled |
| `/equity/security` | AAPL | Settled; expected research-not-created responses |
| `/equity/security/AAPL` | AAPL | Settled; expected research-not-created responses |
| `/equity/commodities` | GC=F | Settled |
| `/equity/forex` | Saved record / page context | Settled |
| `/equity/hotlists` | AAPL | Settled |
| `/equity/insider` | AAPL | Settled |
| `/equity/stocks/about` | AAPL | Settled |
| `/equity/dashboard` | AAPL | Settled |
| `/equity/workflows` | AAPL | Settled |
| `/equity/getting-started` | AAPL | Settled |
| `/equity/heatmap` | AAPL | Settled |
| `/equity/dividends` | AAPL | Settled |
| `/equity/rs` | AAPL | Settled |
| `/equity/data-quality` | AAPL | Settled |
| `/equity/screener` | AAPL | Settled |
| `/equity/factors` | AAPL | Settled |
| `/equity/alpha-zoo` | AAPL | Settled |
| `/equity/research-autopilot` | AAPL | Settled |
| `/equity/strategy-export` | AAPL | Settled |
| `/equity/intelligence-timeline` | AAPL | Settled |
| `/equity/portfolio` | AAPL | Settled |
| `/equity/portfolio/lab` | AAPL | Settled |
| `/equity/portfolio/lab/portfolios/:id` | Saved record / page context | Settled |
| `/equity/portfolio/lab/runs/:runId` | Saved record / page context | Settled |
| `/equity/portfolio/lab/blends` | AAPL | Settled |
| `/equity/mutual-funds` | AAPL | Settled |
| `/equity/bonds` | AAPL | Settled |
| `/equity/watchlist` | AAPL | Settled |
| `/equity/news` | AAPL | Settled |
| `/equity/alerts` | AAPL | Settled |
| `/equity/paper` | AAPL | Settled |
| `/equity/position-sizer` | AAPL | Settled |
| `/equity/journal` | AAPL | Settled |
| `/equity/shadow-account` | AAPL | Settled |
| `/equity/risk` | AAPL | Settled |
| `/equity/correlation` | AAPL | Settled |
| `/equity/stat-lab` | AAPL | Settled |
| `/equity/pair-trading` | AAPL | Settled |
| `/equity/oms` | AAPL | Settled |
| `/equity/ops` | AAPL | Settled |
| `/equity/plugins` | AAPL | Settled |
| `/equity/settings` | AAPL | Settled |
| `/equity/chart-workstation` | AAPL | Settled |
| `/equity/research` | AAPL | Settled |
| `/equity/research-dossiers` | AAPL | Settled |
| `/equity/monitoring` | AAPL | Settled |
| `/equity/mta` | AAPL | Settled |
| `/equity/dom` | AAPL | Settled |
| `/equity/tape` | AAPL | Settled |
| `/equity/launchpad` | AAPL | Settled |
| `/equity/launchpad/popout` | AAPL | Settled |
| `/equity/compare` | AAPL | Settled |
| `/equity/yield-curve` | AAPL | Settled |
| `/equity/bond-analytics` | AAPL | Settled |
| `/equity/option-greeks` | AAPL | Settled |
| `/equity/economics` | Saved record / page context | Settled |
| `/equity/sector-rotation` | Saved record / page context | Settled |
| `/equity/crypto` | BTC-USD | Settled |
| `/equity/etf-analytics` | AAPL | Settled |
| `/equity/cockpit` | AAPL | Settled |
| `/equity/saved-views` | AAPL | Settled |
| `/equity/earnings` | Saved record / page context | Settled |
| `/equity/reports` | AAPL | Settled |
| `/fno` | NIFTY | Settled |
| `/fno/greeks` | NIFTY | Settled |
| `/fno/futures` | NIFTY | Settled |
| `/fno/oi` | NIFTY | Settled |
| `/fno/strategy` | NIFTY | Settled |
| `/fno/pcr` | NIFTY | Settled |
| `/fno/flow` | NIFTY | Settled |
| `/fno/heatmap` | NIFTY | Settled |
| `/fno/expiry` | NIFTY | Settled |
| `/fno/about` | NIFTY | Settled |
| `/backtesting` | Saved record / page context | Settled |
| `/backtesting/model-lab` | Saved record / page context | Settled |
| `/backtesting/model-lab/experiments/:id` | Saved record / page context | Settled |
| `/backtesting/model-lab/runs/:runId` | Saved record / page context | Settled |
| `/backtesting/model-lab/compare` | Saved record / page context | Settled |
| `/backtesting/model-governance` | Saved record / page context | Settled |
| `/backtesting/algorithm-framework` | Saved record / page context | Settled |
| `/backtesting/portfolio-optimizer` | Saved record / page context | Settled |
| `/account` | Saved record / page context | Settled |
