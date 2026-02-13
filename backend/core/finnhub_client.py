from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

class FinnhubClient:
    BASE_URL = "https://finnhub.io/api/v1"

    def __init__(self, api_key: Optional[str] = None, timeout: float = 12.0):
        self.api_key = api_key or os.getenv("FINNHUB_API_KEY", "")
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
        symbol = symbol.strip().upper()
        if not symbol.endswith(".NS"):
            return f"{symbol}.NS"
        return symbol

    async def _get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        if self.disabled:
            return {}
        if not self.api_key:
            return {}

        if not self.client:
            await self.initialize()

        p = params or {}
        p["token"] = self.api_key

        try:
            url = f"{self.BASE_URL}{endpoint}"
            response = await self.client.get(url, params=p)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 403 or e.response.status_code == 429:
                logger.warning(f"Finnhub Limit/Error: {e}")
                if e.response.status_code == 403:
                    self.disabled = True
            return {}
        except Exception as e:
            logger.error(f"Finnhub Request Error: {e}")
            return {}

    async def get_company_profile(self, symbol: str) -> Dict[str, Any]:
        return await self._get("/stock/profile2", {"symbol": self._symbol(symbol)})

    async def get_basic_financials(self, symbol: str) -> Dict[str, Any]:
        return await self._get("/stock/metric", {"symbol": self._symbol(symbol), "metric": "all"})

    async def get_recommendation_trends(self, symbol: str) -> List[Dict[str, Any]]:
        # Returns list of recommendation objects
        data = await self._get("/stock/recommendation", {"symbol": self._symbol(symbol)})
        return data if isinstance(data, list) else []

    async def get_price_target(self, symbol: str) -> Dict[str, Any]:
        return await self._get("/stock/price-target", {"symbol": self._symbol(symbol)})

    async def get_insider_transactions(self, symbol: str, limit: int = 10) -> Dict[str, Any]:
        return await self._get("/stock/insider-transactions", {"symbol": self._symbol(symbol), "limit": limit})
