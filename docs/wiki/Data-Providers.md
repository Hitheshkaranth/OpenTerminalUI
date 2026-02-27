# Data Providers

OpenTerminalUI uses a **multi-provider waterfall architecture** — each data request tries the highest-quality provider first, and falls back automatically on failure. This ensures resilience against rate limits, scraping breakage, and API outages.

---

## India Providers

| Provider | Role | Data Types | Rate Limit | SLA | Auth Required |
|---|---|---|---|---|---|
| **Zerodha Kite** | Primary | Real-time ticks, OHLCV historical (all intervals) | ~3 req/s REST; ~60,000 ticks/day WS | Yes — Zerodha brokerage account | `KITE_API_KEY`, `KITE_API_SECRET`, `KITE_ACCESS_TOKEN` |
| **yfinance** | Fallback | OHLCV historical (`RELIANCE.NS`, `TCS.NS` format) | ~2,000 calls/day per IP (unofficial) | None — scraping-based | None |
| **NSEPython** | Tertiary | NSE website data (F&O, OI, PCR, corporate actions) | None documented | None — scraping-based | None (pin version ≥ 2.97) |

---

## US Providers

| Provider | Role | Data Types | Rate Limit | SLA | Auth Required |
|---|---|---|---|---|---|
| **FMP (Financial Modeling Prep)** | Primary historical | OHLCV, fundamentals, earnings, news | 250 calls/day (free tier); paid plans available | Yes — REST API with documented uptime | `FMP_API_KEY` |
| **Finnhub** | Real-time WS + REST fallback | Real-time ticks (WebSocket), OHLCV, news | 60 calls/min REST; 50 symbol WS (free tier) | Yes — commercial API | `FINNHUB_API_KEY` |
| **yfinance** | Last resort | OHLCV historical | ~2,000 calls/day per IP | None — scraping-based | None |

---

## Provider Risk Register

Condensed from `QC_MASTER_PLAN.md`:

| Provider | Risk | Severity | Mitigation |
|---|---|---|---|
| Kite | Daily access token expiry | High | Automate morning token refresh; app logs clear auth error |
| Kite | Rate limit (3 req/s) | Medium | Retry with exponential backoff; OHLCV cache absorbs repeated requests |
| Finnhub WS | 50-symbol free tier cap | Medium | Subscribe only to active watchlist symbols; upgrade plan for more |
| Finnhub WS | WebSocket schema change | Low | Version-pin client; CI smoke test covers WS message parsing |
| FMP | 250 calls/day free tier | High | Cache all responses (TTL 900s default); switch to paid plan for production |
| FMP | 15-minute delayed data | Medium | Document delay; use Kite/Finnhub for real-time use cases |
| yfinance | No SLA, scraping-based | High | Only used as last resort; log when activated; do not depend on for production |
| yfinance | ~2K calls/day per IP | Medium | Only triggered on fallback; add IP rotation if needed for batch jobs |
| NSEPython | Scraping-based, no SLA | High | Pin version ≥ 2.97; test NSE scraping in CI with mocks |
| NSEPython | NSE website structure changes | High | Monitor NSEPython GitHub; version-lock in requirements.txt |

---

## OHLCV Cache

All chart data responses are cached to reduce upstream API load:

- **Primary cache:** SQLite via `backend/db/ohlcv_cache.py` — per-symbol, per-interval cache with configurable TTL (default 900 seconds via `CHART_CACHE_TTL` env var)
- **L2 cache (optional):** Redis — set `REDIS_URL` in `.env` to enable. Falls back to SQLite if Redis is unavailable.
- **Cache invalidation:** TTL-based expiry. Live candles from the WebSocket stream update in-memory state without touching the cache.
- **Cache warming:** Set `OPENTERMINALUI_PREFETCH_ENABLED=1` to enable background prefetch for configured symbols on startup.

---

## Adding a New Provider

1. Create a class in `backend/providers/` implementing the provider interface:

```python
class MyProvider:
    async def get_ohlcv(
        self,
        symbol: str,
        interval: str,        # "1m", "5m", "1h", "1d", etc.
        from_ts: int,
        to_ts: int,
    ) -> list[OHLCVBar]:
        ...
```

2. Register it in `backend/providers/chart_data.py` in the appropriate waterfall chain (India or US).

3. Add a mock for CI in `backend/tests/mocks/mock_<provider>.py` following the pattern in `mock_kite.py`.

4. Write at least one test in `backend/tests/test_chart_data_provider.py` covering the new provider's happy path and error/fallback path.

---

## Kite Token Refresh

Zerodha Kite access tokens expire daily at midnight IST. To refresh:

1. Log in to [kite.trade](https://kite.trade) and complete the OAuth flow.
2. Copy the new `access_token` from the redirect URL or your Kite developer app dashboard.
3. Update `KITE_ACCESS_TOKEN` in your `.env` file.
4. Restart the backend (`docker compose restart backend` or restart uvicorn).

The backend will log a clear `KiteException: TokenExpired` error if the token has expired, so monitoring is straightforward.

**Automating the refresh:** Zerodha provides a TOTP-based automation option. You can implement a morning cron job using `kiteconnect` to call `generate_session()` and write the new token to `.env` automatically. See the Kite developer docs for details.
