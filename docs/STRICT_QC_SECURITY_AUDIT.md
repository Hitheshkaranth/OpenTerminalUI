# Strict page QC and security audit — 14 November 2026

> **Remediation update:** the three outstanding items below have been resolved. The latest results are in [Audit remediation](AUDIT_REMEDIATION.md): zero npm advisories, restored NSE derivatives snapshots, and verified FMP key rotation. The original observations below are retained as the audit record.

## Outcome

Reviewed **84 terminal route entries**: 80 routes that open directly and four research detail/report routes using real records created in an isolated audit database. Waited for each route's relevant API requests and visible loading indicators to finish. Also exercised all **11 AAPL Security Hub tabs**, five calculator/filter checks, three mobile views, and supplementary public/authentication routes.

This is a repository and local browser audit, **not a clean production security certification or an exhaustive test of every control**. Missing F&O feeds and remaining dependency advisories prevent an all-clear release recommendation.

## Loading and verification policy

Each route had a 90-second deadline, with at least three seconds after navigation, zero tracked pending page API requests, no visible loading text, and 1.2 seconds of network quiet. Unrelated shell polling was excluded. Tab checks used a 60-second deadline and the same request/loading checks. Polling and request completion alone do not establish that returned market data is correct.

Record routes used AAPL/MSFT research definitions and completed reports. The isolated backend ran on port 8010 with test authentication enabled; browser authorization behavior was separately checked on the normal frontend in a fresh session. Backend auth/CSRF/ownership tests exercised enforced security rules. Test authentication does not prove production authentication works.

Initial hot-reload exceptions occurred on Commodities and F&O Flow while shared code was being edited. Both were revisited after edits stabilized and had no browser exceptions. Raw initial evidence is retained rather than relabeled as passing.

## Fixed findings

| ID | Severity | Reproduction and fix | Evidence |
| --- | --- | --- | --- |
| S1 | High | Research document URLs could reach arbitrary/private destinations and follow unchecked redirects. Restricted schemes/ports, rejected nonpublic DNS answers and credentials, pinned the resolved public address while preserving TLS hostname verification, revalidated redirects, disabled environment proxies, and bounded downloads to 10 MiB. | 16 fetch/network tests; real public HTTPS download succeeded. |
| S2 | High | Untrusted research text entered printable HTML. Encoded raw markup, restricted citation links to HTTP(S) without credentials, and detached the print window opener. | Research print security tests. |
| S3 | High | CSV/XLSX strings beginning with formula prefixes could execute in spreadsheet software. Neutralized formula strings in general and screener exports, table CSV, and clipboard cells; kept actual numeric values numeric. | Export and spreadsheet tests, including XLSX cell types and injected headers. |
| S4 | Medium | Export filenames could inject response header content. Restricted names, lengths and extensions; quoted the download filename. | Export filename injection test. |
| S5 | Medium | Watchlist writes accepted invalid names, symbols and oversized batches. Added normalization, format/size limits, atomic validation, and preserved owner isolation. | Watchlist validation and ownership tests. |
| S6 | Medium | Native page requests had inconsistent refresh/CSRF behavior; the existing global fetch shim used an overly broad prefix boundary. Unified native transport and restricted credential attachment by parsed origin and API path boundary. | Origin lookalike, path boundary, refresh and CSRF tests. The app already had a global bearer shim; a general missing-bearer claim would be incorrect. |
| S7 | High | Ownership warnings could expose authenticated provider URLs. Replaced raw provider exception messages and sanitized warnings during model validation, including older cached responses. | Fake-secret regression test. No credential values are included in this report. |
| D1 | High | Gold URLs could reset to Crude Oil. Preserved the requested category/symbol, warned on unsupported symbols, cleared previous instrument details during loading, and labeled synthetic fallbacks. Malformed successful detail responses no longer masquerade as provider data; seasonal years are no longer inflated to at least five. | Gold and Crude browser retests and commodity selection tests. |
| D2 | High | Futures UI mixed underlying history and contracts, advertised unsupported 4H intervals, showed unconditional live labels, and converted missing quotes to zero. Added explicit underlying labels, supported interval filtering, linked chain selection, truthful missing/error states, missing-value handling, and canonical NIFTY/BANKNIFTY index history identifiers. | NIFTY, BANKNIFTY, RELIANCE and AAPL retests; futures integrity tests. |
| D3 | High | Factor ideas could rank alphabetically when all observations were missing, and decomposition fabricated factors without inputs. Excluded unsupported rows, preserved missing metrics, tied equal scores, and returned unavailable decomposition without observed factors. | Factor regression tests and empty-state browser retest. |
| D4 | High | Time & Sales displayed generated executions without provenance. Added source/simulation metadata throughout backend and client transport and a visible simulation notice. Added request-error feedback. | Backend/client tests; actual browser notice and buy-only filter verified. |
| D5 | High | ETF screens invented holdings on missing data and generated random fund flows. Removed those fallbacks, made missing flows explicit, and refused overlap calculation when required holdings are absent. | ETF regression tests and loaded AAPL ETF screen. |
| D6 | High | Raw-material percentage changes were multiplied by 100 twice (for example, approximately -6.6% displayed as -663.4%). Corrected percentage-point formatting while retaining fractional share formatting. | UI regression fixture aligned with backend units; AAPL peers retest showed -6.6%. |
| D7 | Medium | News sentiment objects rendered as “[object Object]” with false zero confidence. Normalized flat and nested payload shapes and preserved absent confidence. | Shape regression tests and loaded AAPL News tab. |
| D8 | High | FMP holder fallback implied 100% public ownership without an observed percentage breakdown. Returned unavailable percentages, hid fallback values, and explained the separate holder records. | Backend regression and final ownership screen with dashes and availability notice. |
| D9 | Medium | Login/registration presented hardcoded ticker prices without sample labeling and claimed an unverified online system status. Added a visible illustrative-price notice and neutral access-portal label. | Public-screen browser retest. |
| U1 | Low | Export failures used alerts or silent console errors. Added visible accessible feedback and clipboard failure handling. | Frontend regression suite and build. |

## Functional results

These checks used actual browser controls and API responses:

| Check | Input | Observed |
| --- | --- | --- |
| Black–Scholes call | Spot/strike 100, one year, rate 5%, volatility 20%, dividend 0 | 10.450584; UI 10.4506 |
| Black–Scholes put | Same assumptions | 5.573526; UI 5.5735 |
| Par bond | Coupon/yield 5%, face 1,000, five years, annual payments | Price 1,000; UI 1,000.00 |
| Fixed fractional sizing | Account 100,000, risk 1%, entry 100, stop 95 | 200 shares, position 20,000, risk 1,000 |
| Tape filter | AAPL, Buys Only | All 34 inspected visible rows had buy side; simulation notice present |

Gold and Crude loaded their own quotes, history and curves. AAPL and RELIANCE quotes and history rendered. Final NIFTY and BANKNIFTY underlying charts also loaded after correcting their index identifiers. These were checked for instrument identity and UI consistency; they were not independently reconciled against exchange records.

All eleven AAPL Security Hub tabs settled: Overview, Financials, Chart, News, Ownership, Estimates, Peers, ESG, Tape, Insider and Filings. Missing filing/analysis endpoints returned 404 and explicit empty guidance, rather than being counted as available filings.

At 390 × 844, AAPL Security Hub, Gold and RELIANCE futures completed loading without document-level horizontal overflow or browser exceptions. Dense tables retain local horizontal scrolling. This is not a WCAG conformance assessment.

A fresh session on the normal frontend rendered login, registration and access recovery; a protected stock route redirected to login; an invalid research-share token showed an unavailable/revoked state.

## Automated validation

- **837 frontend tests passed across 163 files.**
- **105 targeted backend tests passed**, including authentication, CSRF, owner isolation, export, watchlist, factor, research-fetch, tape, ETF, ownership, commodity and FX regressions.
- Two additional existing promoter-holdings route tests passed.
- Production TypeScript/Vite build passed; existing large-chunk warnings remain.
- `git diff --check` passed.
- Dependency scan and compatible updates removed the three production high-severity findings. Removed unused `react-mosaic-component`.

## Original release limits and subsequent resolution

1. **Resolved for NSE snapshots in the follow-up.** Original observation: live NSE derivatives results were not verified. Initial NIFTY/BANKNIFTY history was empty because index aliases were sent as equity symbols. After correcting them to ^NSEI/^NSEBANK, both underlying charts loaded (25,144.30 and 61,034.10 in this session). NIFTY/BANKNIFTY/RELIANCE still had no contract expiry chain available. The UI now says so. Broker/provider connectivity is required for a live contract acceptance test.
2. **Resolved in the follow-up: the full npm audit now reports zero.** Original observation: production has two moderate React Router dependency findings. The full audit has five findings: three moderate and two critical, with the critical findings in development test tooling through Tinypool. npm reports major React Router/Vitest upgrades as the remediation. Compatible updates were applied without forcing those migrations. See the saved audit JSON for exact installed ranges and advisories.
3. No Python CVE scan, external penetration test, load test, or real broker execution was performed. Backend security regression tests do not cover every endpoint or deployment configuration.
4. OMS operational controls and real broker actions were not executed. Default-page checks do not prove every mutation, modal, export, or long-running research combination works.
5. The test backend/provider setup can return unavailable data. Sample notices and honest empty states improve integrity but do not supply the missing feeds.
6. **Resolved:** regenerated the exposed FMP key, verified the replacement with HTTP 200 and rejection of the old key with HTTP 401, and reloaded the app API. The error sanitization prevents this response path from exposing it again.

## Evidence

- [Full initial and record route observations](../output/page-audit/loaded-pages-all.json)
- [Stock/commodity/futures retests](../output/page-audit/retests.json)
- [Security Hub tabs](../output/page-audit/tabs-evidence.json)
- [Final ownership check](../output/page-audit/ownershipFinal-evidence.json)
- [Mobile results](../output/page-audit/mobile-evidence.json)
- [Production dependency audit after updates](../output/page-audit/npm-audit-after.json)
- [Full dependency audit after updates](../output/page-audit/npm-audit-all-after.json)
- [Final index-history checks](../output/page-audit/index-final-evidence.json)
- [Public route checks](../output/page-audit/public-evidence.json)
- [Public ticker label retests](../output/page-audit/public-final-evidence.json)
- [Screenshot gallery](../output/page-audit/index.html)

## Reproducing the route loading checks

The reusable local runner is `frontend/scripts/audit-loaded-pages.mjs`. Start the isolated test backend and frontend first, then run `node frontend/scripts/audit-loaded-pages.mjs` from the repo root. `QC_BASE_URL` can override the default test frontend URL (`http://127.0.0.1:5174`). It writes `output/page-audit/reproduced-loaded-pages.json` and exits nonzero on timeouts or browser exceptions. The runner covers the 80 direct route entries; record creation, tab interactions and numeric checks are separate. Its syntax was checked; browser observations above came from the equivalent Playwright CLI callback.

## Route-by-route loading observations

“Settled” means the page completed the loading policy above, including valid empty states. It is not a declaration that every feature passed. Initial exceptions on Commodities/Flow are superseded by the separate stable retests. HTTP codes include expected unavailable-document responses.

| Route | Loading result | Wait seconds | Browser exceptions | HTTP error observations |
| --- | --- | ---: | ---: | --- |
| `/home` | Settled | 3.6 | 0 | — |
| `/equity/stocks?ticker=AAPL` | Settled | 5.2 | 0 | — |
| `/equity/security?ticker=AAPL` | Settled | 11.8 | 0 | 404, 404, 404, 404, 404, 404, 404, 404 |
| `/equity/security/AAPL?ticker=AAPL` | Settled | 8.0 | 0 | 404, 404, 404, 404, 404, 404, 404, 404 |
| `/equity/commodities?symbol=GC%3DF` | Settled | 84.0 | 4 | — |
| `/equity/forex?pair=EURUSD` | Settled | 3.3 | 0 | — |
| `/equity/hotlists?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/insider?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/stocks/about?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/dashboard?ticker=AAPL` | Settled | 4.5 | 0 | — |
| `/equity/workflows?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/getting-started?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/heatmap?ticker=AAPL` | Settled | 5.7 | 0 | — |
| `/equity/dividends?ticker=AAPL` | Settled | 5.7 | 0 | — |
| `/equity/rs?ticker=AAPL` | Settled | 5.9 | 0 | — |
| `/equity/data-quality?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/screener?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/factors?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/alpha-zoo?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/research-autopilot?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/strategy-export?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/intelligence-timeline?ticker=AAPL` | Settled | 4.2 | 0 | — |
| `/equity/portfolio?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/portfolio/lab?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/portfolio/lab/blends?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/mutual-funds?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/bonds?ticker=AAPL` | Settled | 3.1 | 0 | — |
| `/equity/watchlist?ticker=AAPL` | Settled | 5.7 | 0 | — |
| `/equity/news?ticker=AAPL` | Settled | 4.7 | 0 | — |
| `/equity/alerts?ticker=AAPL` | Settled | 3.1 | 0 | — |
| `/equity/paper?ticker=AAPL` | Settled | 3.1 | 0 | — |
| `/equity/position-sizer?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/journal?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/shadow-account?ticker=AAPL` | Settled | 3.1 | 0 | — |
| `/equity/risk?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/correlation?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/stat-lab?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/pair-trading?ticker=AAPL` | Settled | 4.9 | 0 | — |
| `/equity/oms?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/ops?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/plugins?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/settings?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/chart-workstation?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/research?ticker=AAPL` | Settled | 3.3 | 0 | — |
| `/equity/research-dossiers?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/monitoring?ticker=AAPL` | Settled | 3.1 | 0 | — |
| `/equity/mta?ticker=AAPL` | Settled | 4.2 | 0 | — |
| `/equity/dom?ticker=AAPL` | Settled | 4.7 | 0 | — |
| `/equity/tape?ticker=AAPL` | Settled | 5.9 | 0 | — |
| `/equity/launchpad?ticker=AAPL` | Settled | 6.4 | 0 | — |
| `/equity/launchpad/popout?ticker=AAPL` | Settled | 4.1 | 0 | — |
| `/equity/compare?ticker=AAPL` | Settled | 4.8 | 0 | — |
| `/equity/yield-curve?ticker=AAPL` | Settled | 3.1 | 0 | — |
| `/equity/bond-analytics?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/option-greeks?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/economics?ticker=AAPL` | Settled | 6.7 | 0 | — |
| `/equity/sector-rotation?ticker=AAPL` | Settled | 3.1 | 0 | — |
| `/equity/crypto?symbol=BTC-USD` | Settled | 3.3 | 0 | — |
| `/equity/etf-analytics?ticker=AAPL` | Settled | 3.2 | 0 | — |
| `/equity/cockpit?ticker=AAPL` | Settled | 5.7 | 0 | — |
| `/equity/saved-views?ticker=AAPL` | Settled | 3.1 | 0 | — |
| `/equity/earnings?ticker=AAPL` | Settled | 3.1 | 0 | — |
| `/equity/reports?ticker=AAPL` | Settled | 3.1 | 0 | — |
| `/fno` | Settled | 3.1 | 0 | — |
| `/fno/greeks?symbol=NIFTY` | Settled | 3.2 | 0 | — |
| `/fno/futures?symbol=NIFTY` | Settled | 7.5 | 0 | — |
| `/fno/oi?symbol=NIFTY` | Settled | 4.4 | 0 | — |
| `/fno/strategy?symbol=NIFTY` | Settled | 3.1 | 0 | — |
| `/fno/pcr?symbol=NIFTY` | Settled | 3.9 | 0 | — |
| `/fno/flow?symbol=NIFTY` | Settled | 12.3 | 2 | — |
| `/fno/heatmap?symbol=NIFTY` | Settled | 14.3 | 0 | — |
| `/fno/expiry?symbol=NIFTY` | Settled | 3.2 | 0 | — |
| `/fno/about?symbol=NIFTY` | Settled | 3.2 | 0 | — |
| `/backtesting` | Settled | 4.0 | 0 | — |
| `/backtesting/model-lab` | Settled | 3.2 | 0 | — |
| `/backtesting/model-lab/compare` | Settled | 3.1 | 0 | — |
| `/backtesting/model-governance` | Settled | 3.1 | 0 | — |
| `/backtesting/algorithm-framework` | Settled | 3.1 | 0 | — |
| `/backtesting/portfolio-optimizer` | Settled | 3.2 | 0 | — |
| `/account` | Settled | 3.2 | 0 | — |
| `/equity/portfolio/lab/portfolios/4bf64e3b-cbde-4cef-b9a0-1d017519279a` | Settled | 4.2 | 0 | — |
| `/equity/portfolio/lab/runs/bf789c04-b009-492a-acbf-60c753e52bfb` | Settled | 4.0 | 0 | — |
| `/backtesting/model-lab/experiments/60bb4547-9ef2-41b5-abc9-cbba9d036a7a` | Settled | 3.7 | 0 | — |
| `/backtesting/model-lab/runs/03c7dd2d-794e-4db4-9cfa-f9df5bbeada9` | Settled | 3.7 | 0 | — |
