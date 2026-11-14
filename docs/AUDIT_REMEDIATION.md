# Audit remediation — 14 November 2026

The three outstanding items from the strict audit are resolved: npm advisories, missing NSE derivatives data, and the exposed Financial Modeling Prep credential.

## Dependency findings — closed

Upgraded React Router to **7.18.5**, Vitest to **5.1.0**, and Vite to **6.4.6**. The full npm audit, including development packages, reports **zero vulnerabilities**. Updated the removed Vitest pool configuration, declared the Node minimum, and changed the Docker frontend build to Node 22. CI already selects Node 22.

Vitest 5 requires Vite >=6.4 and Node >=22.12; the runtime/configuration changes follow its [official migration guidance](https://vitest.dev/guide/migration/). Routing was checked against the [React Router v7 migration guidance](https://reactrouter.com/7.18.5/upgrading/v6).

Evidence: [complete npm audit](../output/page-audit/npm-audit-remediated.json).

## NSE data findings — closed for snapshot workflows

The old option-chain and derivative-quote endpoints returned 404. Restored the official flows:

- Option chains fetch published expiries from `/api/option-chain-contract-info`, then request `/api/option-chain-v3` with the provider-formatted expiry and correct index/equity type.
- Added v3 expiry and bid/ask field aliases, filtered rows by the selected expiry, and corrected NSE timestamps from India time to UTC.
- NIFTY/BANKNIFTY no longer fall through to the unknown-equity US classification.
- Futures use observed snapshots from the API called by the official NSE derivatives page. The service preserves unavailable broker identifiers rather than inventing tokens, removes implicit generated-contract fallback, and exposes source/timestamp metadata.
- Existing broker catalogue rows retain their real identifiers; NSE observations fill missing quote values by expiry.
- Moved the futures table out of the narrow sidebar and added accessible selector names.
- Versioned the derivative caches so old empty/incorrectly routed responses cannot survive the migration.

The endpoints and request parameters were verified against the [official NSE option-chain page](https://www.nseindia.com/option-chain) and its published JavaScript, and the [official derivatives page](https://www.nseindia.in/get-quote/derivatives/NIFTY/NIFTY-50).

Actual browser checks returned populated option chains and futures tables for **NIFTY, BANKNIFTY and RELIANCE**, with no browser exceptions or failed page API responses in the six focused checks. Additional functional tests confirmed:

| Interaction | Result |
| --- | --- |
| Change NIFTY expiry | Selected 2026-11-23; API returned the matching chain and NSE market |
| Enable Greeks | Toggle changed to Hide Greeks |
| Limit strike range to ±10 | Returned 21 strike rows |
| Compare BANKNIFTY futures table against API | All three displayed contract prices matched: 60,942; 61,361; 61,598 |
| Mobile futures at 390 px | Populated table and source notice; no document-level horizontal overflow |

The observed NSE timestamp was **13 November 2026, 15:40 IST**. The checks occurred on Saturday, 14 November, when the market was closed. These are verified exchange snapshots; continuous broker WebSocket ticks were not exercised.

Evidence: [six populated screens](../output/page-audit/remediation/nse-loaded-screens.json), [post-rotation functional results](../output/page-audit/remediation/functional-results.json).

## Exposed credential — rotated and verified

Using the account session supplied by the user, verified that the dashboard key matched the configured key before regeneration. Regenerated it through FMP's key-management control and atomically updated the local `.env`.

- New key: **HTTP 200** on a provider API request.
- Old key: **HTTP 401**, confirming rejection.
- Reloaded the app's audit API using the replacement.
- Secret file permissions: **0600**; the file is ignored by Git.
- No replacement key found in tracked files or the built frontend.
- Deleted the temporary private copy of the provider browser session.
- No credential values are included in committed source, this report, or the evidence JSON.

FMP documents regeneration through its dashboard in the [official FAQ](https://site.financialmodelingprep.com/faqs?code=data). The unrelated service listening on port 8000 was inspected and left running; it belongs to another project.

Evidence: [rotation result, without key values](../output/page-audit/remediation/credential-rotation.json), [storage checks](../output/page-audit/remediation/secret-storage-checks.json).

## Final verification

- **839 frontend tests passed across 164 files** on the patched dependencies.
- **149 targeted backend tests passed**, covering security regressions, auth, ownership, NSE v3 normalization, index classification, futures source handling, Greeks/OI and derivative tools.
- Production TypeScript/Vite build passed. Existing bundle-size warnings remain.
- **84 terminal route entries** repeated after the dependency upgrades: 80 direct routes plus four real record/report routes; all completed the request/loading policy with **zero browser exceptions**.
- Public login, protected-route redirection and an invalid research-share link passed in a fresh session.
- `git diff --check` passed.

The first functional expiry attempt used an incorrectly matched selector. Inspection confirmed populated expiry data; explicit accessible names were added and the control-driven check then passed. This was not recorded as a provider-data pass until the actual interaction succeeded.

Evidence: [80 route observations](../output/page-audit/remediation/all-loaded-pages.json), [four record routes](../output/page-audit/remediation/record-loaded-pages.json), [screenshot gallery](../output/page-audit/index.html).

This closes the three listed findings within the tested local scope. It does not assert an external penetration-test certification, a Python dependency CVE scan, exchange reconciliation of every analytical metric, or real broker execution.

## CI follow-up: blank watchlist creation rows

The full GitHub backend suite exposed a compatibility regression: creating a watchlist with a blank import row returned 422 instead of retaining its valid symbols. Creation now drops blank rows before identifier validation. Nonblank malformed identifiers still reject the complete write, bulk updates remain strict, and request size limits remain enforced. The original failing regression and the watchlist validation/ownership checks pass together (31 tests); five new cases cover blank rows and rejected mixed input. Full verification runs in the [main CI workflow](https://github.com/Hitheshkaranth/OpenTerminalUI/actions/workflows/ci.yml).
