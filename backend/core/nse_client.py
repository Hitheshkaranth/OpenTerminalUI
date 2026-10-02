from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)



def _to_num(value) -> float | None:
    try:
        return float(str(value).replace(",", "")) if value not in (None, "", "-") else None
    except ValueError:
        return None

class NSEBlockedError(RuntimeError):
    """Raised when NSE is hard-blocking requests (HTTP 403/401) and the
    circuit breaker is open. Callers should fall back to another provider."""


DEFAULT_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0",
]

class NSESession:
    def __init__(self, user_agent: str, timeout: float):
        self.user_agent = user_agent
        self.timeout = timeout
        self.client: Optional[httpx.AsyncClient] = None
        self.cookies_loaded = False

    async def initialize(self):
        if self.client:
            await self.client.aclose()

        headers = {
            "User-Agent": self.user_agent,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            # Avoid brotli payloads when decoder support is inconsistent.
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
            "Referer": "https://www.nseindia.com/",
        }

        self.client = httpx.AsyncClient(
            http2=True,
            timeout=self.timeout,
            headers=headers,
            follow_redirects=True,
            trust_env=False,  # Bypass local proxies to avoid interference
        )
        self.cookies_loaded = False

    async def ensure_cookies(self):
        if not self.client:
            await self.initialize()

        if self.cookies_loaded:
            return

        try:
            # Hit homepage to get cookies
            await self.client.get("https://www.nseindia.com", timeout=self.timeout)
            self.cookies_loaded = True
        except Exception as e:
            logger.error(f"Failed to refresh NSE cookies: {e}")
            raise

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None

class NSEClient:
    BASE_URL = "https://www.nseindia.com"
    API_BASE_URL = "https://www.nseindia.com/api"

    # Circuit breaker: NSE hard-blocks datacenter IPs with HTTP 403. Once we
    # see repeated blocks, stop hammering it (and re-initializing sessions) for
    # a cooldown so callers fall back to other providers immediately instead of
    # paying ~tens of seconds of retries + backoff per request.
    _CB_THRESHOLD = 3
    _CB_COOLDOWN = 300.0  # seconds

    def __init__(self, sessions_count: int = 3, rate_limit_per_sec: int = 3):
        self.sessions_count = sessions_count
        self.rate_limit_delay = 1.0 / rate_limit_per_sec
        self.sessions: list[NSESession] = []
        self._session_idx = 0
        self._lock = asyncio.Lock()
        self._last_request_time = 0.0
        self._cb_fail_count = 0
        self._cb_open_until = 0.0

    def _circuit_open(self) -> bool:
        return time.time() < self._cb_open_until

    def _note_block(self) -> None:
        self._cb_fail_count += 1
        if self._cb_fail_count >= self._CB_THRESHOLD:
            self._cb_open_until = time.time() + self._CB_COOLDOWN
            logger.warning(
                "NSE circuit breaker OPEN for %.0fs after %d consecutive blocks; "
                "failing fast and deferring to fallback providers.",
                self._CB_COOLDOWN,
                self._cb_fail_count,
            )

    def _note_success(self) -> None:
        self._cb_fail_count = 0
        self._cb_open_until = 0.0

    async def _get_session(self) -> NSESession:
        async with self._lock:
            if not self.sessions:
                # Initialize pool
                for i in range(self.sessions_count):
                    ua = DEFAULT_USER_AGENTS[i % len(DEFAULT_USER_AGENTS)]
                    session = NSESession(ua, timeout=10.0)
                    await session.initialize()
                    self.sessions.append(session)

            # Rotate sessions
            session = self.sessions[self._session_idx]
            self._session_idx = (self._session_idx + 1) % len(self.sessions)

            # Rate limiting
            now = time.time()
            elapsed = now - self._last_request_time
            if elapsed < self.rate_limit_delay:
                await asyncio.sleep(self.rate_limit_delay - elapsed)
            self._last_request_time = time.time()

            return session

    async def _request(self, endpoint: str, params: dict = None, attempt: int = 1) -> Any:
        # Fail fast while the breaker is open so callers fall back immediately.
        if self._circuit_open():
            raise NSEBlockedError(
                f"NSE circuit breaker open; skipping {endpoint}"
            )

        session = await self._get_session()

        try:
            await session.ensure_cookies()
            if not session.client:
                 raise RuntimeError("Session client not initialized")

            url = f"{self.API_BASE_URL}{endpoint}"
            response = await session.client.get(url, params=params)

            if response.status_code == 401 or response.status_code == 403:
                # Cookie expiry or hard block. Refresh once cheaply, then give up
                # fast — repeated re-init + exponential backoff was costing tens
                # of seconds per request when NSE blocks the IP outright.
                logger.warning(f"NSE {response.status_code} for {endpoint}. Refreshing session.")
                self._note_block()
                if attempt < 2 and not self._circuit_open():
                    await session.initialize()  # Re-init clears cookies
                    await asyncio.sleep(0.5 + random.random() * 0.5)
                    return await self._request(endpoint, params, attempt + 1)
                raise NSEBlockedError(
                    f"NSE {response.status_code} for {endpoint}"
                )

            if response.status_code == 429:
                # Rate limit
                logger.warning(f"NSE 429 for {endpoint}. Backing off.")
                await asyncio.sleep(2 ** attempt + random.random())
                if attempt < 5:
                    return await self._request(endpoint, params, attempt + 1)
                else:
                    response.raise_for_status()

            response.raise_for_status()
            data = response.json()
            self._note_success()
            return data

        except (httpx.RequestError, httpx.HTTPStatusError, ValueError) as e:
            # ValueError covers malformed/undecodable JSON payloads from upstream.
            if attempt < 3:
                logger.debug(
                    "NSE request retry %s for %s params=%s error=%r",
                    attempt,
                    endpoint,
                    params,
                    e,
                )
                await asyncio.sleep(1)
                return await self._request(endpoint, params, attempt + 1)
            logger.warning("NSE request failed for %s params=%s error=%r", endpoint, params, e)
            raise e

    async def get_quote_equity(self, symbol: str) -> dict:
        """Get real-time quote for equity"""
        return await self._request("/quote-equity", {"symbol": symbol})

    async def get_quote_derivative(self, symbol: str) -> dict:
        """Get real-time quote for derivatives"""
        return await self._request("/quote-derivative", {"symbol": symbol})

    async def get_trade_info(self, symbol: str) -> dict:
        """Get trade info (delivery, vwap, etc)"""
        return await self._request("/quote-equity", {"symbol": symbol, "section": "trade_info"})

    async def get_historical_data(self, symbol: str, from_date: str, to_date: str) -> dict:
        """
        Get historical data for a symbol.
        Dates format: "dd-MM-yyyy" (e.g., "01-01-2023")
        """
        return await self._request("/historical/cm/equity", {
            "symbol": symbol,
            "series": '["EQ"]',
            "from": from_date,
            "to": to_date
        })

    async def get_index_quote(self, index: str) -> dict:
        """Get real-time index quote (e.g., NIFTY 50)"""
        return await self._request("/allIndices", {})

    async def get_option_chain(self, symbol: str) -> dict:
        """Get option chain data"""
        return await self._request("/option-chain-indices", {"symbol": symbol})

    async def get_market_status(self) -> dict:
        """Get market status"""
        return await self._request("/marketStatus")

    async def get_corp_info(self, symbol: str) -> dict:
        """Corporate announcements, board meetings etc"""
        return await self._request("/quote-equity", {"symbol": symbol, "section": "corp_info"})

    async def get_chart_data(self, symbol: str, pre_open: bool = False) -> dict:
        """
        Get chart data endpoint used by NSE's own charts.
        Note: This is often tricky and might change.
        """
        return await self._request("/chart-databyindex", {"index": symbol, "preopen": "true" if pre_open else "false"})

    async def _large_deals(self, key: str) -> dict:
        # NSE retired /snapshot-capital-market-bulk-block-deals (404); the large-deal snapshot
        # carries bulk, block and short deals. Rows keep NSE's keys (qty, watp) and also expose
        # quantity / tradePrice / dealValue for existing consumers (Dashboard bulk-deals table).
        payload = await self._request("/snapshot-capital-market-largedeal")
        rows = payload.get(key) if isinstance(payload, dict) else None
        out = []
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            qty = _to_num(row.get("qty"))
            price = _to_num(row.get("watp"))
            out.append({**row, "quantity": qty, "tradePrice": price,
                        "dealValue": qty * price if qty is not None and price is not None else None})
        return {"as_on_date": payload.get("as_on_date") if isinstance(payload, dict) else None, "data": out}

    async def get_bulk_deals(self) -> dict:
        """Get snapshot of bulk deals"""
        return await self._large_deals("BULK_DEALS_DATA")

    async def get_block_deals(self) -> dict:
        """Get snapshot of block deals"""
        return await self._large_deals("BLOCK_DEALS_DATA")

    async def close(self):
        """Close all sessions"""
        for session in self.sessions:
            await session.close()
