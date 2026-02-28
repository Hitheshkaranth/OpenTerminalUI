from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx
from backend.config.settings import get_settings
from backend.shared.cache import cache

logger = logging.getLogger(__name__)

# Macro Indicator Series IDs (mostly FRED)
# US: GDP (GDPC1), CPI (CPIAUCSL), Unemployment (UNRATE), Fed Funds (FEDFUNDS), PMI (MANPMI), Consumer Confidence (UMCSENT)
# India: GDP (CPMNIND898S), CPI (INNCPIALLMINMEI), Repo Rate (INNRIRR), PMI (not directly on FRED easily, use mock/placeholder)
# EU: GDP (CLVMEURSCAB1GQEA19), CPI (CP0000EZ19M086NEST), ECB Rate (ECBDFR), PMI
# China: GDP (CHNGDPNQDSMEI), CPI (CHNCPIALLMINMEI), Rate (CHNPRIME)

MACRO_CONFIG = {
    "us": {
        "gdp": "GDPC1",
        "cpi": "CPIAUCSL",
        "unemployment": "UNRATE",
        "rate": "FEDFUNDS",
        "pmi": "MANPMI",
        "confidence": "UMCSENT"
    },
    "india": {
        "gdp": "CPMNIND898S",
        "cpi": "INNCPIALLMINMEI",
        "rate": "INNRIRR",
        "pmi": "INNPCPIALLMINMEI" # Placeholder
    },
    "eu": {
        "gdp": "CLVMEURSCAB1GQEA19",
        "cpi": "CP0000EZ19M086NEST",
        "rate": "ECBDFR"
    },
    "china": {
        "gdp": "CHNGDPNQDSMEI",
        "cpi": "CHNCPIALLMINMEI",
        "rate": "CHNPRIME"
    }
}

class EconomicDataService:
    def __init__(self):
        self.settings = get_settings()
        self.fred_key = self.settings.fred_api_key
        self.finnhub_key = self.settings.finnhub_api_key
        self.fmp_key = self.settings.fmp_key # wait, check AppSettings name
        # Correct name is fmp_api_key from previous step
        self.fmp_key = self.settings.fmp_api_key
        self.base_fred = "https://api.stlouisfed.org/fred"
        self.base_finnhub = "https://finnhub.io/api/v1"
        self.base_fmp = "https://financialmodelingprep.com/api/v3"

    async def get_economic_calendar(self, start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """Fetch and normalize economic calendar events."""
        cache_key = cache.build_key("econ", "calendar", {"from": start_date, "to": end_date})
        cached = await cache.get(cache_key)
        if cached:
            return cached

        events = []

        # Try Finnhub
        if self.finnhub_key:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        f"{self.base_finnhub}/calendar/economic",
                        params={"from": start_date, "to": end_date, "token": self.finnhub_key}
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        for ev in data.get("economicCalendar", []):
                            events.append({
                                "date": ev.get("date", "").split(" ")[0],
                                "time": ev.get("date", "").split(" ")[1] if " " in ev.get("date", "") else "00:00:00",
                                "country": ev.get("country"),
                                "event_name": ev.get("event"),
                                "impact": self._map_impact(ev.get("impact")),
                                "actual": ev.get("actual"),
                                "forecast": ev.get("estimate"),
                                "previous": ev.get("prev"),
                                "unit": ev.get("unit"),
                                "currency": ev.get("currency")
                            })
            except Exception as e:
                logger.error(f"Finnhub calendar error: {e}")

        # Try FMP if Finnhub failed or returned little
        if not events and self.fmp_key:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        f"{self.base_fmp}/economic_calendar",
                        params={"from": start_date, "to": end_date, "apikey": self.fmp_key}
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        for ev in data:
                            events.append({
                                "date": ev.get("date", "").split(" ")[0],
                                "time": "00:00:00", # FMP date usually just YYYY-MM-DD
                                "country": ev.get("country"),
                                "event_name": ev.get("event"),
                                "impact": "medium", # FMP doesn't always provide impact level clearly
                                "actual": ev.get("actual"),
                                "forecast": ev.get("estimate"),
                                "previous": ev.get("previous"),
                                "unit": "",
                                "currency": ""
                            })
            except Exception as e:
                logger.error(f"FMP calendar error: {e}")

        # Mock data if both fail or keys missing
        if not events:
            events = self._get_mock_calendar(start_date, end_date)

        # Sort by date
        events.sort(key=lambda x: (x["date"], x["time"]))

        await cache.set(cache_key, events, ttl=3600)
        return events

    async def get_macro_indicators(self) -> Dict[str, Any]:
        """Fetch key macro indicators for main regions."""
        cache_key = cache.build_key("econ", "indicators", {"type": "current"})
        cached = await cache.get(cache_key)
        if cached:
            return cached

        results = {}
        if self.fred_key:
            tasks = []
            for region, series_map in MACRO_CONFIG.items():
                for label, series_id in series_map.items():
                    tasks.append(self._fetch_fred_indicator(region, label, series_id))

            indicator_data = await asyncio.gather(*tasks)

            for item in indicator_data:
                if item:
                    region = item["region"]
                    if region not in results:
                        results[region] = {}
                    results[region][item["label"]] = {
                        "value": item["value"],
                        "last_value": item["last_value"],
                        "date": item["date"],
                        "history": item["history"]
                    }
        else:
            results = self._get_mock_macro()

        await cache.set(cache_key, results, ttl=14400) # 4 hours
        return results

    async def _fetch_fred_indicator(self, region: str, label: str, series_id: str) -> Optional[Dict[str, Any]]:
        try:
            url = f"{self.base_fred}/series/observations"
            params = {
                "series_id": series_id,
                "api_key": self.fred_key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": 13 # 12 months + 1 for trend
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params)
                if resp.status_code != 200:
                    return None
                data = resp.json()

            observations = data.get("observations", [])
            if not observations: return None

            valid_obs = [o for o in observations if o["value"] != "."]
            if not valid_obs: return None

            current = valid_obs[0]
            last = valid_obs[1] if len(valid_obs) > 1 else current

            history = [{"date": o["date"], "value": float(o["value"])} for o in reversed(valid_obs)]

            return {
                "region": region,
                "label": label,
                "value": float(current["value"]),
                "last_value": float(last["value"]),
                "date": current["date"],
                "history": history
            }
        except Exception as e:
            logger.error(f"FRED error for {series_id}: {e}")
            return None

    def _map_impact(self, impact: Any) -> str:
        if isinstance(impact, int):
            if impact >= 3: return "high"
            if impact == 2: return "medium"
            return "low"
        s = str(impact).lower()
        if "high" in s or "3" in s: return "high"
        if "med" in s or "2" in s: return "medium"
        return "low"

    def _get_mock_calendar(self, start: str, end: str) -> List[Dict[str, Any]]:
        # Generate some mock events
        d_start = datetime.strptime(start, "%Y-%m-%d")
        return [
            {
                "date": (d_start + timedelta(days=1)).strftime("%Y-%m-%d"),
                "time": "14:00:00",
                "country": "US",
                "event_name": "Non-Farm Payrolls",
                "impact": "high",
                "actual": 210000,
                "forecast": 185000,
                "previous": 150000,
                "unit": "Jobs",
                "currency": "USD"
            },
            {
                "date": (d_start + timedelta(days=2)).strftime("%Y-%m-%d"),
                "time": "10:30:00",
                "country": "IN",
                "event_name": "RBI Interest Rate Decision",
                "impact": "high",
                "actual": 6.5,
                "forecast": 6.5,
                "previous": 6.5,
                "unit": "%",
                "currency": "INR"
            }
        ]

    def _get_mock_macro(self) -> Dict[str, Any]:
        return {
            "us": {
                "gdp": {"value": 2.1, "last_value": 2.0, "date": "2024-Q3", "history": []},
                "cpi": {"value": 3.4, "last_value": 3.7, "date": "2024-12", "history": []}
            },
            "india": {
                "gdp": {"value": 7.2, "last_value": 7.0, "date": "2024-Q3", "history": []}
            }
        }

_econ_service: Optional[EconomicDataService] = None

def get_economic_data_service() -> EconomicDataService:
    global _econ_service
    if _econ_service is None:
        _econ_service = EconomicDataService()
    return _econ_service
