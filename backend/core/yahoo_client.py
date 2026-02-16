from __future__ import annotations

import asyncio
import logging
from typing import Any, List, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

# Constants for Fundamental Timeseries modules
ANNUAL_MODULES = [
    "annualTotalRevenue",
    "annualNetIncome", 
    "annualEbitda",
    "annualOperatingIncome",
    "annualDilutedEPS",
    "annualBasicEPS",
    "annualTotalExpenses",
    "annualGrossProfit",
    "annualCostOfRevenue",
    "annualPretaxIncome",
    "annualTaxProvision",
    "annualNetIncomeCommonStockholders",
    "annualDilutedAverageShares",
    "annualBasicAverageShares",
    "annualOperatingExpense",
    "annualTotalAssets",
    "annualTotalLiabilitiesNetMinorityInterest",
    "annualTotalEquityGrossMinorityInterest",
    "annualTotalCapitalization",
    "annualStockholdersEquity",
    "annualWorkingCapital",
    "annualInvestedCapital",
    "annualTangibleBookValue",
    "annualTotalDebt",
    "annualNetDebt",
    "annualShareIssued",
    "annualFreeCashFlow",
    "annualOperatingCashFlow",
    "annualInvestingCashFlow",
    "annualFinancingCashFlow",
    "annualCapitalExpenditure",
]

QUARTERLY_MODULES = [
    "quarterlyTotalRevenue",
    "quarterlyNetIncome",
    "quarterlyEbitda",
    "quarterlyOperatingIncome",
    "quarterlyDilutedEPS",
    "quarterlyBasicEPS",
    "quarterlyTotalExpenses",
    "quarterlyGrossProfit",
    "quarterlyCostOfRevenue",
    "quarterlyPretaxIncome",
    "quarterlyTaxProvision",
    "quarterlyNetIncomeCommonStockholders",
    "quarterlyDilutedAverageShares",
    "quarterlyBasicAverageShares",
    "quarterlyOperatingExpense",
    "quarterlyTotalAssets",
    "quarterlyTotalLiabilitiesNetMinorityInterest",
    "quarterlyTotalEquityGrossMinorityInterest",
    "quarterlyTotalCapitalization",
    "quarterlyStockholdersEquity",
    "quarterlyWorkingCapital",
    "quarterlyInvestedCapital",
    "quarterlyTangibleBookValue",
    "quarterlyTotalDebt",
    "quarterlyNetDebt",
    "quarterlyShareIssued",
    "quarterlyFreeCashFlow",
    "quarterlyOperatingCashFlow",
    "quarterlyInvestingCashFlow",
    "quarterlyFinancingCashFlow",
    "quarterlyCapitalExpenditure",
]

class YahooClient:
    def __init__(self, timeout_seconds: float = 10.0):
        self.timeout = timeout_seconds
        self.client: Optional[httpx.AsyncClient] = None
        self._crumb: Optional[str] = None

    async def initialize(self):
        if self.client:
            return

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
        }

        self.client = httpx.AsyncClient(
            http2=True,
            timeout=self.timeout,
            headers=headers,
            follow_redirects=True,
            trust_env=False,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20)
        )

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None
        self._crumb = None

    async def _ensure_client(self):
        if not self.client:
            await self.initialize()

    async def _ensure_crumb(self):
        """Fetch Yahoo cookie + crumb for authenticated API requests."""
        if self._crumb:
            return
        await self._ensure_client()
        try:
            # Visit fc.yahoo.com to obtain consent cookies (stored in httpx client jar)
            await self.client.get("https://fc.yahoo.com")
            # Use cookies to obtain a crumb token
            resp = await self.client.get("https://query2.finance.yahoo.com/v1/test/getcrumb")
            if resp.status_code == 200:
                self._crumb = resp.text.strip()
        except Exception as e:
            logger.warning(f"Failed to get Yahoo crumb: {e}")

    async def get_quotes(self, symbols: List[str]) -> List[Dict[str, Any]]:
        """
        Get real-time quotes for multiple symbols (automatically batched).
        """
        await self._ensure_client()

        # Deduplicate
        symbols = list(set(symbols))
        results = []

        # Chunk into batches of 20
        chunk_size = 20
        for i in range(0, len(symbols), chunk_size):
            batch = symbols[i : i + chunk_size]
            try:
                params: Dict[str, str] = {"symbols": ",".join(batch)}
                response = await self.client.get("https://query1.finance.yahoo.com/v7/finance/quote", params=params)
                if response.status_code == 401:
                    self._crumb = None
                    await self._ensure_crumb()
                    if self._crumb:
                        params["crumb"] = self._crumb
                        response = await self.client.get("https://query1.finance.yahoo.com/v7/finance/quote", params=params)
                response.raise_for_status()
                data = response.json()
                quotes = (data.get("quoteResponse") or {}).get("result") or []
                results.extend(quotes)

            except Exception as e:
                logger.error(f"Failed to fetch Yahoo quotes for batch {batch}: {e}")

        return results

    async def get_quote_summary(self, symbol: str, modules: Optional[List[str]] = None) -> Dict[str, Any]:
        """Get comprehensive data from Yahoo quoteSummary v10 API."""
        await self._ensure_client()
        if modules is None:
            modules = ["financialData", "summaryDetail", "defaultKeyStatistics", "assetProfile"]
        try:
            params: Dict[str, str] = {"modules": ",".join(modules)}
            response = await self.client.get(
                f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}",
                params=params,
            )
            if response.status_code == 401:
                self._crumb = None
                await self._ensure_crumb()
                if self._crumb:
                    params["crumb"] = self._crumb
                    response = await self.client.get(
                        f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}",
                        params=params,
                    )
            response.raise_for_status()
            data = response.json()
            results = (data.get("quoteSummary") or {}).get("result") or [{}]
            return results[0] if results else {}
        except Exception as e:
            logger.warning(f"Yahoo quoteSummary failed for {symbol}: {e}")
            return {}

    async def get_chart(self, symbol: str, range_str: str = "1y", interval: str = "1d") -> Dict[str, Any]:
        """
        Get chart data (OHLCV) with dividends and splits.
        """
        await self._ensure_client()
        
        try:
            # v8/finance/chart
            response = await self.client.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
                params={
                    "range": range_str,
                    "interval": interval,
                    "events": "div,splits",
                    "includePrePost": "false"
                }
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Failed to fetch Yahoo chart for {symbol}: {e}")
            raise

    async def get_fundamentals_timeseries(self, symbol: str, period1: int = 946684800, period2: int = 1999999999) -> Dict[str, Any]:
        """
        Get historical fundamentals (revenue, eps, etc.).
        Combined wrapper for fetching both ANNUAL and QUARTERLY modules.
        """
        await self._ensure_client()
        await self._ensure_crumb()

        all_modules = ANNUAL_MODULES + QUARTERLY_MODULES
        chunk_size = 5
        result_data = {}

        async def fetch_chunk(modules_chunk):
            try:
                params: Dict[str, Any] = {
                    "symbol": symbol,
                    "type": ",".join(modules_chunk),
                    "period1": period1,
                    "period2": period2,
                }
                if self._crumb:
                    params["crumb"] = self._crumb
                response = await self.client.get(
                    f"https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}",
                    params=params,
                )
                if response.status_code == 200:
                    data = response.json()
                    ts_result = (data.get("timeseries") or {}).get("result") or []
                    return ts_result
            except Exception as e:
                logger.warning(f"Yahoo fundamental chunk failed: {e}")
            return []

        tasks = []
        for i in range(0, len(all_modules), chunk_size):
            chunk = all_modules[i : i + chunk_size]
            tasks.append(fetch_chunk(chunk))
            
        results_lists = await asyncio.gather(*tasks)
        
        # Merge results
        for lst in results_lists:
            for item in lst:
                meta = item.get("meta", {})
                start = item.get("timestamp", [])
                vals = []
                # Timeseries values are inside a dynamic key usually matching the type?
                # Actually usage is usually: item[type] (list of dicts)
                # But here the structure is:
                # { "meta": { "type": ["annualTotalRevenue"] }, "timestamp": [...], "annualTotalRevenue": [...] }
                t = meta.get("type", [])
                if t and len(t) > 0:
                    type_key = t[0]
                    if type_key in item:
                        result_data[type_key] = {
                            "timestamp": start,
                            "value": item[type_key]
                        }

        return result_data

    async def get_asset_profile(self, symbol: str) -> Dict[str, Any]:
        """Get asset profile (sector, industry, description)."""
        summary = await self.get_quote_summary(symbol, ["assetProfile"])
        return summary.get("assetProfile", {})

    async def search_news(self, query: str, limit: int = 30) -> List[Dict[str, Any]]:
        """
        Query Yahoo Finance search endpoint and return raw news rows.
        This endpoint does not require API keys and works for broad queries.
        """
        await self._ensure_client()
        q = (query or "").strip()
        if not q:
            return []
        try:
            response = await self.client.get(
                "https://query1.finance.yahoo.com/v1/finance/search",
                params={
                    "q": q,
                    "newsCount": max(1, min(limit, 100)),
                    "quotesCount": 0,
                    "listsCount": 0,
                },
            )
            if response.status_code == 401:
                self._crumb = None
                await self._ensure_crumb()
                params = {
                    "q": q,
                    "newsCount": max(1, min(limit, 100)),
                    "quotesCount": 0,
                    "listsCount": 0,
                }
                if self._crumb:
                    params["crumb"] = self._crumb
                response = await self.client.get(
                    "https://query1.finance.yahoo.com/v1/finance/search",
                    params=params,
                )
            response.raise_for_status()
            payload = response.json()
            rows = payload.get("news") if isinstance(payload, dict) else []
            if not isinstance(rows, list):
                return []
            return [x for x in rows if isinstance(x, dict)][:limit]
        except Exception as e:
            logger.warning(f"Yahoo news search failed for {q}: {e}")
            return []
