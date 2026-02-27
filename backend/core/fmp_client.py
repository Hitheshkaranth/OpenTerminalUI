from __future__ import annotations

import logging
import os
from typing import Any, List, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

class FMPClient:
    BASE_URL = "https://financialmodelingprep.com/api/v3"

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

        p = params or {}
        p["apikey"] = self.api_key

        try:
            url = f"{self.BASE_URL}{endpoint}"
            response = await self.client.get(url, params=p)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 403:
                logger.error("FMP API Key Invalid or Limit Reached")
                self.disabled = True
            logger.error(f"FMP Request Failed: {e}")
            return []
        except Exception as e:
            logger.error(f"FMP Request Error: {e}")
            return []

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        data = await self._get(f"/quote/{self._symbol(symbol)}")
        return data[0] if data and isinstance(data, list) else {}

    async def get_historical_price_full(self, symbol: str) -> Dict[str, Any]:
        return await self._get(f"/historical-price-full/{self._symbol(symbol)}")

    async def get_income_statement(self, symbol: str, period: str = "annual", limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get(f"/income-statement/{self._symbol(symbol)}", {"period": period, "limit": limit})

    async def get_balance_sheet(self, symbol: str, period: str = "annual", limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get(f"/balance-sheet-statement/{self._symbol(symbol)}", {"period": period, "limit": limit})

    async def get_cash_flow(self, symbol: str, period: str = "annual", limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get(f"/cash-flow-statement/{self._symbol(symbol)}", {"period": period, "limit": limit})

    async def get_key_metrics_ttm(self, symbol: str) -> List[Dict[str, Any]]:
        return await self._get(f"/key-metrics-ttm/{self._symbol(symbol)}")

    async def get_ratios_ttm(self, symbol: str) -> List[Dict[str, Any]]:
        return await self._get(f"/ratios-ttm/{self._symbol(symbol)}")

    async def get_financial_growth(self, symbol: str, limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get(f"/financial-growth/{self._symbol(symbol)}", {"limit": limit})

    async def get_dcf(self, symbol: str) -> List[Dict[str, Any]]:
        return await self._get(f"/discounted-cash-flow/{self._symbol(symbol)}")

    async def get_profile(self, symbol: str) -> Dict[str, Any]:
        data = await self._get(f"/profile/{self._symbol(symbol)}")
        return data[0] if data and isinstance(data, list) else {}

    async def _get_symbol_list(self, endpoint_prefix: str, symbol: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        raw = symbol.strip().upper()
        candidates = [raw]
        ns = self._symbol(raw)
        if ns not in candidates:
            candidates.append(ns)
        for candidate in candidates:
            data = await self._get(f"{endpoint_prefix}/{candidate}", params)
            if isinstance(data, list) and data:
                return data
        return []

    async def get_institutional_holders(self, symbol: str, limit: int = 50) -> List[Dict[str, Any]]:
        rows = await self._get_symbol_list("/institutional-holder", symbol)
        return rows[:limit] if isinstance(rows, list) else []

    async def get_analyst_estimates(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        rows = await self._get_symbol_list("/analyst-estimates", symbol, {"limit": limit})
        return rows if isinstance(rows, list) else []

    async def get_esg_data(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        raw = symbol.strip().upper()
        candidates = [raw]
        ns = self._symbol(raw)
        if ns not in candidates:
            candidates.append(ns)
        for candidate in candidates:
            data = await self._get("/esg-environmental-social-governance-data", {"symbol": candidate, "limit": limit})
            if isinstance(data, list) and data:
                return data
        return []
