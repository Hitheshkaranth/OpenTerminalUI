# Real-data research validation

Verified on 2026-10-25 against a running local API with an isolated SQLite database. This run used downloaded source data, not generated market prices. No production account or database was modified.

## Official financial evidence

Source: [Apple FY2025 Q1 consolidated statements](https://www.apple.com/newsroom/pdfs/fy2025-q1/FY25_Q1_Consolidated_Financial_Statements.pdf), accompanying the [January 30, 2025 release](https://www.apple.com/newsroom/2025/01/apple-reports-first-quarter-results/).

The browser-created AAPL dossier includes services sales of $26.340bn versus $23.117bn, Greater China sales of $18.513bn versus $20.819bn, and total sales of $124.300bn with diluted EPS of $2.40. The thesis is explicitly a historical hypothesis, with facts separated into supporting, opposing and neutral evidence.

- Created the dossier and saved three sourced claims through the UI, including their publication date.
- Ingested the actual three-page PDF; extracted three source passages.
- Searched for services/net sales in the UI, opened a passage, and saved it as neutral evidence.
- Monitoring found one new source; repeating the check returned zero duplicate changes.
- A search with a known-by date of January 29, 2025 returned no passages.
- Desktop and 390 × 844 mobile screenshots inspected. Mobile document width remained 390 pixels.

The downloaded PDF reports an HTTP Last-Modified of March 10, 2025. Retrieval conservatively uses that date for this version; the original release date is retained separately. We have not established that today's PDF bytes match the January release.

PDF SHA-256: `b45c21d81378d635103ac213cddf853599716b42b4df4646b2f5c07e5079c748`.

## Real historical prices and the availability safeguard

Downloaded [Yahoo AAPL daily history](https://finance.yahoo.com/quote/AAPL/history/) through its chart endpoint: 251 rows from October 24, 2025 through October 23, 2026. Raw JSON, adjusted-close values, download timestamp and hashes were preserved. The numerical engine used the quote OHLC series, with no independent adjustment audit.

The core SMA engine produced identical output in two executions over the frozen real rows, with 20/50 windows, 5 basis points each for fees and slippage, and a one-bar fill delay. This establishes deterministic computation on the downloaded dataset, not investment performance or point-in-time historical correctness.

The strict experiment API correctly rejected all 251 bars with HTTP 422: the vendor did not supply historical availability timestamps, and the truthful download time is later than every bar. No availability timestamp was backdated. This dataset therefore cannot honestly be presented as a successfully saved point-in-time experiment. Existing saved-experiment UI/replay tests use explicitly controlled fixtures.

Raw-price JSON SHA-256: `6e5f7830eba84f74a81938a46ff5a72beb59a60836c02027aed1329f83b63f78`.

Local downloaded artifacts and machine-readable results are in `/tmp/ot-real-data/`; browser screenshots are in `output/playwright/`. These temporary files are not required to run the app and are not bundled as production fixtures.
