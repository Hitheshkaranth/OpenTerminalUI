from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx
from backend.config.settings import get_settings
from backend.shared.cache import cache

logger = logging.getLogger(__name__)

MATURITIES = [
    {"label": "1M", "series_id": "DGS1MO", "order": 1},
    {"label": "2M", "series_id": "DGS2MO", "order": 2},
    {"label": "3M", "series_id": "DGS3MO", "order": 3},
    {"label": "6M", "series_id": "DGS6MO", "order": 4},
    {"label": "1Y", "series_id": "DGS1", "order": 5},
    {"label": "2Y", "series_id": "DGS2", "order": 6},
    {"label": "3Y", "series_id": "DGS3", "order": 7},
    {"label": "5Y", "series_id": "DGS5", "order": 8},
    {"label": "7Y", "series_id": "DGS7", "order": 9},
    {"label": "10Y", "series_id": "DGS10", "order": 10},
    {"label": "20Y", "series_id": "DGS20", "order": 11},
    {"label": "30Y", "series_id": "DGS30", "order": 12},
]

class FixedIncomeService:
    def __init__(self):
        self.settings = get_settings()
        self.api_key = self.settings.fred_api_key
        self.base_url = "https://api.stlouisfed.org/fred"

    async def get_yield_curve(self) -> Dict[str, Any]:
        """Fetch current yield curve data."""
        if not self.api_key:
            logger.warning("FRED_API_KEY not set. Returning mock data.")
            return self._get_mock_yield_curve()

        cache_key = cache.build_key("fixed_income", "yield_curve", {"type": "current"})
        cached = await cache.get(cache_key)
        if cached:
            return cached

        results = []
        tasks = [self._fetch_series_with_history(m["series_id"], m["label"], m["order"]) for m in MATURITIES]
        fetched_data = await asyncio.gather(*tasks)

        for data in fetched_data:
            if data:
                results.append(data)

        # Sort by order
        results.sort(key=lambda x: x["order"])

        # Calculate spreads (e.g., 2s10s)
        spreads = self._calculate_spreads(results)

        response = {
            "date": datetime.now().strftime("%Y-%m-%d"),
            "data": results,
            "spreads": spreads
        }

        await cache.set(cache_key, response, ttl=3600)  # 1 hour cache
        return response

    async def get_historical_yield_curve(self, date_str: str) -> Dict[str, Any]:
        """Fetch yield curve data for a specific date."""
        if not self.api_key:
            return self._get_mock_yield_curve(date_str)

        cache_key = cache.build_key("fixed_income", "yield_curve_hist", {"date": date_str})
        cached = await cache.get(cache_key)
        if cached:
            return cached

        results = []
        tasks = [self._fetch_series_at_date(m["series_id"], m["label"], m["order"], date_str) for m in MATURITIES]
        fetched_data = await asyncio.gather(*tasks)

        for data in fetched_data:
            if data:
                results.append(data)

        results.sort(key=lambda x: x["order"])

        response = {
            "date": date_str,
            "data": results
        }

        await cache.set(cache_key, response, ttl=86400)  # 24 hours cache for historical
        return response

    async def _fetch_series_with_history(self, series_id: str, label: str, order: int) -> Optional[Dict[str, Any]]:
        """Fetch a series and its historical points to calculate changes."""
        try:
            # Fetch last 14 months to be safe for 1Y change
            end_date = datetime.now()
            start_date = end_date - timedelta(days=400)

            url = f"{self.base_url}/series/observations"
            params = {
                "series_id": series_id,
                "api_key": self.api_key,
                "file_type": "json",
                "observation_start": start_date.strftime("%Y-%m-%d"),
                "observation_end": end_date.strftime("%Y-%m-%d"),
                "sort_order": "desc"
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()

            observations = data.get("observations", [])
            if not observations:
                return None

            # Filter out '.' values which FRED sometimes returns for missing data
            valid_obs = [o for o in observations if o["value"] != "."]
            if not valid_obs:
                return None

            current = valid_obs[0]
            curr_val = float(current["value"])
            curr_date = datetime.strptime(current["date"], "%Y-%m-%d")

            # Find historical values
            def find_closest(target_date: datetime):
                best_diff = timedelta(days=365*10)
                best_val = None
                for o in valid_obs:
                    if o["value"] == ".": continue
                    o_date = datetime.strptime(o["date"], "%Y-%m-%d")
                    diff = abs(o_date - target_date)
                    if diff < best_diff:
                        best_diff = diff
                        best_val = float(o["value"])
                    if o_date < target_date - timedelta(days=7): # Optimization: FRED returns sorted desc
                         break
                return best_val

            val_1d = find_closest(curr_date - timedelta(days=1))
            val_1w = find_closest(curr_date - timedelta(days=7))
            val_1m = find_closest(curr_date - timedelta(days=30))
            val_1y = find_closest(curr_date - timedelta(days=365))

            return {
                "label": label,
                "series_id": series_id,
                "order": order,
                "yield": curr_val,
                "date": current["date"],
                "chg_1d": curr_val - val_1d if val_1d is not None else None,
                "chg_1w": curr_val - val_1w if val_1w is not None else None,
                "chg_1m": curr_val - val_1m if val_1m is not None else None,
                "chg_1y": curr_val - val_1y if val_1y is not None else None,
            }

        except Exception as e:
            logger.error(f"Error fetching FRED series {series_id}: {e}")
            return None

    async def _fetch_series_at_date(self, series_id: str, label: str, order: int, date_str: str) -> Optional[Dict[str, Any]]:
        """Fetch a series value at or near a specific date."""
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d")
            start_date = target_date - timedelta(days=7) # Look back a week to find a valid trading day

            url = f"{self.base_url}/series/observations"
            params = {
                "series_id": series_id,
                "api_key": self.api_key,
                "file_type": "json",
                "observation_start": start_date.strftime("%Y-%m-%d"),
                "observation_end": date_str,
                "sort_order": "desc"
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()

            observations = data.get("observations", [])
            valid_obs = [o for o in observations if o["value"] != "."]
            if not valid_obs:
                return None

            best_obs = valid_obs[0]

            return {
                "label": label,
                "series_id": series_id,
                "order": order,
                "yield": float(best_obs["value"]),
                "date": best_obs["date"]
            }

        except Exception as e:
            logger.error(f"Error fetching historical FRED series {series_id} at {date_str}: {e}")
            return None

    def _calculate_spreads(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculate common spreads like 2s10s."""
        data_map = {r["label"]: r["yield"] for r in results}
        spreads = {}

        if "10Y" in data_map and "2Y" in data_map:
            spreads["2s10s"] = data_map["10Y"] - data_map["2Y"]

        if "30Y" in data_map and "5Y" in data_map:
            spreads["5s30s"] = data_map["30Y"] - data_map["5Y"]

        if "10Y" in data_map and "3M" in data_map:
            spreads["3m10y"] = data_map["10Y"] - data_map["3M"]

        return spreads

    async def get_2s10s_history(self) -> Dict[str, Any]:
        """Fetch historical 2s10s spread data for the chart."""
        if not self.api_key:
            return self._get_mock_2s10s_history()

        cache_key = cache.build_key("fixed_income", "spread_2s10s", {"type": "history"})
        cached = await cache.get(cache_key)
        if cached:
            return cached

        # FRED has a pre-calculated series for T10Y2Y
        try:
            url = f"{self.base_url}/series/observations"
            params = {
                "series_id": "T10Y2Y",
                "api_key": self.api_key,
                "file_type": "json",
                "observation_start": (datetime.now() - timedelta(days=365*2)).strftime("%Y-%m-%d"), # 2 years
                "sort_order": "asc"
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()

            observations = data.get("observations", [])
            history = []
            for o in observations:
                if o["value"] != ".":
                    history.append({
                        "date": o["date"],
                        "value": float(o["value"])
                    })

            response = {"history": history}
            await cache.set(cache_key, response, ttl=3600)
            return response
        except Exception as e:
            logger.error(f"Error fetching 2s10s history: {e}")
            return {"error": str(e)}

    def _get_mock_yield_curve(self, date_str: Optional[str] = None) -> Dict[str, Any]:
        """Generate mock yield curve data."""
        base_yields = {
            "1M": 5.38, "2M": 5.39, "3M": 5.42, "6M": 5.35, "1Y": 4.98,
            "2Y": 4.65, "3Y": 4.45, "5Y": 4.32, "7Y": 4.31, "10Y": 4.30,
            "20Y": 4.55, "30Y": 4.45
        }

        # Invert if date is current-ish (mocking current inverted curve)
        if not date_str:
            date_str = datetime.now().strftime("%Y-%m-%d")

        results = []
        for m in MATURITIES:
            y = base_yields.get(m["label"], 4.0)
            results.append({
                "label": m["label"],
                "series_id": m["series_id"],
                "order": m["order"],
                "yield": y,
                "date": date_str,
                "chg_1d": -0.01,
                "chg_1w": 0.05,
                "chg_1m": -0.12,
                "chg_1y": 1.2
            })

        spreads = {"2s10s": 4.30 - 4.65, "3m10y": 4.30 - 5.42}
        return {"date": date_str, "data": results, "spreads": spreads, "mock": True}

    def _get_mock_2s10s_history(self) -> Dict[str, Any]:
        """Generate mock 2s10s history."""
        history = []
        start_date = datetime.now() - timedelta(days=730)
        for i in range(730):
            d = (start_date + timedelta(days=i)).strftime("%Y-%m-%d")
            # Sine wave to mock inversion
            val = 0.5 * (1.5 - (i / 100)) + 0.2 * (i % 30 / 30)
            if i > 400: val -= 1.0 # Simulate inversion
            history.append({"date": d, "value": val})
        return {"history": history, "mock": True}

_fixed_income_service: Optional[FixedIncomeService] = None

def get_fixed_income_service() -> FixedIncomeService:
    global _fixed_income_service
    if _fixed_income_service is None:
        _fixed_income_service = FixedIncomeService()
    return _fixed_income_service
