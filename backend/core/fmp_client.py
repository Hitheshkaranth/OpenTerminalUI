from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, List, Dict, Optional

import httpx

logger = logging.getLogger(__name__)
_US_SYMBOLS_CACHE: set[str] | None = None


def _known_us_symbols() -> set[str]:
    global _US_SYMBOLS_CACHE
    if _US_SYMBOLS_CACHE is not None:
        return _US_SYMBOLS_CACHE
    data_dir = Path(__file__).resolve().parents[1] / "data"
    out: set[str] = set()
    for name in ("us_sp500_symbols.txt", "us_nasdaq100_symbols.txt", "us_all_symbols.txt"):
        path = data_dir / name
        if not path.exists():
            continue
        out.update(line.strip().upper() for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    _US_SYMBOLS_CACHE = out
    return out

class FMPClient:
    # Migrated from the retired v3 API to FMP's "stable" API. The stable API
    # passes the ticker as a `symbol` query param (not a path segment) and
    # renamed a few endpoints (e.g. historical-price-full -> historical-price-eod/full).
    BASE_URL = "https://financialmodelingprep.com/stable"

    def __init__(self, api_key: Optional[str] = None, timeout: float = 12.0):
        self.api_key = api_key or os.getenv("FMP_API_KEY", "")
        self.timeout = timeout
        self.client: Optional[httpx.AsyncClient] = None
        self.disabled = False

    async def initialize(self):
        if self.client:
            return

        self.client = httpx.AsyncClient(
            timeout=self.timeout,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            trust_env=False,
            follow_redirects=True,
        )

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None

    def _symbol(self, symbol: str) -> str:
        # FMP usually expects .NS for NSE
        symbol = symbol.strip().upper()
        if "." in symbol:
            return symbol
        if symbol in _known_us_symbols():
            return symbol
        if not symbol.endswith(".NS"):
            return f"{symbol}.NS"
        return symbol

    async def _get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        if self.disabled:
            return []
        if not self.api_key:
            return []

        if not self.client:
            await self.initialize()

        p = dict(params or {})
        p["apikey"] = self.api_key

        try:
            url = f"{self.BASE_URL}/{endpoint.lstrip('/')}"
            response = await self.client.get(url, params=p)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status == 401:
                # 401 = invalid/expired key -> stop hammering the API for this process.
                logger.error("FMP API key invalid (401); disabling FMP for this session.")
                self.disabled = True
            elif status == 402:
                # 402 = endpoint/symbol not in the current subscription tier (e.g. intraday,
                # institutional ownership, ESG, or non-US symbols). Per-call restriction only.
                logger.debug("FMP restricted endpoint %s (402); skipping.", endpoint)
            else:
                logger.warning("FMP request failed for %s: %s", endpoint, e)
            return []
        except Exception as e:
            logger.error(f"FMP Request Error: {e}")
            return []

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        data = await self._get("quote", {"symbol": self._symbol(symbol)})
        row = data[0] if data and isinstance(data, list) else {}
        if isinstance(row, dict) and "changePercentage" in row and "changesPercentage" not in row:
            # v3 callers expect `changesPercentage`; stable renamed it to `changePercentage`.
            row["changesPercentage"] = row.get("changePercentage")
        return row if isinstance(row, dict) else {}

    async def get_historical_price_full(self, symbol: str) -> Dict[str, Any]:
        # Stable returns a flat list; wrap it to the v3 {"symbol","historical":[...]} shape
        # that downstream chart code already consumes.
        data = await self._get("historical-price-eod/full", {"symbol": self._symbol(symbol)})
        if isinstance(data, list) and data:
            return {"symbol": self._symbol(symbol), "historical": data}
        return {}

    async def get_income_statement(self, symbol: str, period: str = "annual", limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get("income-statement", {"symbol": self._symbol(symbol), "period": period, "limit": limit})

    async def get_balance_sheet(self, symbol: str, period: str = "annual", limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get("balance-sheet-statement", {"symbol": self._symbol(symbol), "period": period, "limit": limit})

    async def get_cash_flow(self, symbol: str, period: str = "annual", limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get("cash-flow-statement", {"symbol": self._symbol(symbol), "period": period, "limit": limit})

    async def get_key_metrics_ttm(self, symbol: str) -> List[Dict[str, Any]]:
        return await self._get("key-metrics-ttm", {"symbol": self._symbol(symbol)})

    async def get_ratios_ttm(self, symbol: str) -> List[Dict[str, Any]]:
        return await self._get("ratios-ttm", {"symbol": self._symbol(symbol)})

    async def get_financial_growth(self, symbol: str, limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get("financial-growth", {"symbol": self._symbol(symbol), "limit": limit})

    async def get_dcf(self, symbol: str) -> List[Dict[str, Any]]:
        return await self._get("discounted-cash-flow", {"symbol": self._symbol(symbol)})

    async def get_profile(self, symbol: str) -> Dict[str, Any]:
        data = await self._get("profile", {"symbol": self._symbol(symbol)})
        return data[0] if data and isinstance(data, list) else {}

    async def get_institutional_holders(self, symbol: str, limit: int = 50) -> List[Dict[str, Any]]:
        # Stable institutional-ownership endpoints are premium-tier; returns [] gracefully
        # (callers fall back to other providers) when not subscribed.
        rows = await self._get("institutional-ownership/symbol-positions-summary", {"symbol": self._symbol(symbol)})
        return rows[:limit] if isinstance(rows, list) else []

    async def get_analyst_estimates(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        rows = await self._get("analyst-estimates", {"symbol": self._symbol(symbol), "period": "annual", "limit": limit})
        return rows if isinstance(rows, list) else []

    async def get_esg_data(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        # ESG is premium-tier on stable; returns [] gracefully when not subscribed.
        rows = await self._get("esg-disclosures", {"symbol": self._symbol(symbol), "limit": limit})
        return rows if isinstance(rows, list) else []
