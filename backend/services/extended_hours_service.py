
import logging
from datetime import datetime, time as dt_time, timezone, timedelta
from enum import Enum
from typing import Optional, List, Dict, Any
from zoneinfo import ZoneInfo
import httpx
import os

logger = logging.getLogger(__name__)

class TradingSession(str, Enum):
    PRE_MARKET = "pre"
    REGULAR = "rth"
    AFTER_HOURS = "post"
    PRE_OPEN = "pre_open"      # Indian market
    CLOSING = "closing"         # Indian market closing session

# US market session boundaries (Eastern Time)
US_SESSIONS = {
    TradingSession.PRE_MARKET:  (dt_time(4, 0), dt_time(9, 30)),
    TradingSession.REGULAR:     (dt_time(9, 30), dt_time(16, 0)),
    TradingSession.AFTER_HOURS: (dt_time(16, 0), dt_time(20, 0)),
}

# Indian market session boundaries (IST)
IN_SESSIONS = {
    TradingSession.PRE_OPEN:    (dt_time(9, 0), dt_time(9, 15)),
    TradingSession.REGULAR:     (dt_time(9, 15), dt_time(15, 30)),
    TradingSession.CLOSING:     (dt_time(15, 30), dt_time(15, 40)),
}


class ExtendedHoursService:
    """
    Fetches and tags OHLCV data with session metadata.
    Delegates to the appropriate adapter based on market.
    """

    def __init__(self):
        self.fmp_key = os.getenv("FMP_API_KEY", "").strip()
        self.finnhub_key = os.getenv("FINNHUB_API_KEY", "").strip()
        # In a real app, we'd inject these or use a registry
        from backend.providers.chart_data import get_chart_data_provider
        self.provider_factory = get_chart_data_provider

    async def get_chart_data(
        self,
        symbol: str,
        timeframe: str,
        market: str,
        extended: bool = False,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch OHLCV data. If extended=True, include pre/post market bars.
        """
        # Normalize user-facing market/exchange inputs into:
        # 1) session region for tagging ("US"/"IN")
        # 2) provider market hint (exchange code expected by providers)
        session_market, provider_market_hint = self._normalize_market_inputs(market)
        timeframe = self._normalize_timeframe(timeframe)

        provider = await self.provider_factory()

        # Determine date_from/to timestamps if provided
        start_dt = None
        if date_from:
            try:
                start_dt = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
            except ValueError:
                pass

        end_dt = None
        if date_to:
            try:
                end_dt = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc)
            except ValueError:
                pass

        # If not US and not extended, just use standard provider
        if not extended or session_market != "US":
             bars = await provider.get_ohlcv(
                symbol,
                interval=timeframe,
                start=start_dt,
                end=end_dt,
                market_hint=provider_market_hint
            )
             tagged = [self._tag_session(self._to_dict(bar), session_market) for bar in bars]
             return tagged

        # For US Extended, try FMP/Finnhub/Yahoo with extended flags
        bars = await self._fetch_us_extended(symbol, timeframe, extended, start_dt, end_dt)

        # Tag each bar with session info
        tagged = [self._tag_session(bar, session_market) for bar in bars]
        return tagged

    def _normalize_market_inputs(self, market: str) -> tuple[str, str]:
        value = (market or "").strip().upper()
        if value in {"NYSE", "NASDAQ", "AMEX", "US"}:
            return "US", ("NASDAQ" if value == "US" else value)
        if value in {"NSE", "BSE", "NFO", "IN"}:
            return "IN", ("NSE" if value == "IN" else value)
        # Conservative fallback keeps provider compatibility while disabling session specialization.
        return value or "IN", (value or "NSE")

    def _normalize_timeframe(self, timeframe: str) -> str:
        raw = (timeframe or "1d").strip()
        tf = raw.lower()
        aliases = {
            "60m": "1h",
            "1hr": "1h",
            "1day": "1d",
            "1wk": "1wk",
            "1w": "1wk",
            "1mo": "1mo",
            "1mth": "1mo",
        }
        return aliases.get(tf, tf)

    def _to_dict(self, bar):
        return {
            "time": int(bar.timestamp.timestamp()),
            "open": bar.open,
            "high": bar.high,
            "low": bar.low,
            "close": bar.close,
            "volume": bar.volume,
        }

    async def _fetch_us_extended(self, symbol, timeframe, extended, start_dt, end_dt):
        """
        Try multiple providers in priority order for US extended hours.
        """
        # Simplification: Use the existing ChartDataProvider but we might need to modify it
        # to support the 'extended' flag for FMP/Finnhub/Yahoo.
        # For this task, I'll implement the specific ETH fetchers here as requested.

        results = []
        if self.fmp_key:
            results = await self._fetch_fmp_extended(symbol, timeframe, extended, start_dt, end_dt)
            if results:
                return results

        if self.finnhub_key:
            results = await self._fetch_finnhub_extended(symbol, timeframe, extended, start_dt, end_dt)
            if results:
                return results

        # Fallback to standard provider (which uses yfinance)
        provider = await self.provider_factory()
        bars = await provider.get_ohlcv(symbol, interval=timeframe, start=start_dt, end=end_dt, market_hint="US")
        return [self._to_dict(b) for b in bars]

    async def _fetch_fmp_extended(self, symbol, timeframe, extended, start_dt, end_dt):
        interval_map = {"1m": "1min", "5m": "5min", "15m": "15min", "1h": "1hour", "1d": "daily"}
        interval = interval_map.get(timeframe, "5min")

        if interval == "daily":
             url = f"https://financialmodelingprep.com/api/v3/historical-price-full/{symbol}"
        else:
             url = f"https://financialmodelingprep.com/api/v3/historical-chart/{interval}/{symbol}"

        params = {"apikey": self.fmp_key}
        if extended and interval != "daily":
            params["extended"] = "true"
        if start_dt:
            params["from"] = start_dt.strftime("%Y-%m-%d")
        if end_dt:
            params["to"] = end_dt.strftime("%Y-%m-%d")

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()

            records = data.get("historical", []) if isinstance(data, dict) else data if isinstance(data, list) else []
            return self._normalize_fmp(records)
        except Exception as e:
            logger.warning(f"FMP extended fetch failed: {e}")
            return []

    def _normalize_fmp(self, records):
        bars = []
        for row in records:
            dt_str = row.get("date")
            if not dt_str:
                continue
            try:
                # FMP dates can be "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD"
                if len(dt_str) == 10:
                    dt = datetime.strptime(dt_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                else:
                    dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)

                bars.append({
                    "time": int(dt.timestamp()),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row.get("volume", 0)),
                })
            except Exception:
                continue
        bars.sort(key=lambda x: x["time"])
        return bars

    async def _fetch_finnhub_extended(self, symbol, timeframe, extended, start_dt, end_dt):
        resolution_map = {"1m": "1", "5m": "5", "15m": "15", "1h": "60", "1d": "D"}
        resolution = resolution_map.get(timeframe, "5")

        _end = end_dt or datetime.now(timezone.utc)
        _start = start_dt or (_end - timedelta(days=7))

        params = {
            "symbol": symbol,
            "resolution": resolution,
            "from": int(_start.timestamp()),
            "to": int(_end.timestamp()),
            "token": self.finnhub_key,
        }
        if extended and resolution != "D":
            params["prepost"] = "true"

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get("https://finnhub.io/api/v1/stock/candle", params=params)
                resp.raise_for_status()
                data = resp.json()

            if data.get("s") != "ok":
                return []

            bars = []
            for i, ts in enumerate(data["t"]):
                bars.append({
                    "time": int(ts),
                    "open": float(data["o"][i]),
                    "high": float(data["h"][i]),
                    "low": float(data["l"][i]),
                    "close": float(data["c"][i]),
                    "volume": float(data["v"][i]),
                })
            return bars
        except Exception as e:
            logger.warning(f"Finnhub extended fetch failed: {e}")
            return []

    def _tag_session(self, bar: dict, market: str) -> dict:
        """
        Determine which trading session a bar belongs to based on its timestamp.
        """
        if market == "US":
            tz = ZoneInfo("America/New_York")
            sessions = US_SESSIONS
        elif market == "IN":
            tz = ZoneInfo("Asia/Kolkata")
            sessions = IN_SESSIONS
        else:
            bar["session"] = "rth"
            bar["isExtended"] = False
            return bar

        bar_dt = datetime.fromtimestamp(bar["time"], tz=tz)
        bar_time = bar_dt.time()

        for session_name, (start, end) in sessions.items():
            if start <= bar_time < end:
                bar["session"] = session_name.value
                bar["isExtended"] = session_name != TradingSession.REGULAR
                return bar

        # Outside all sessions (should not happen if data is clean)
        bar["session"] = "rth"
        bar["isExtended"] = False
        return bar

_extended_hours_service: Optional[ExtendedHoursService] = None

async def get_extended_hours_service() -> ExtendedHoursService:
    global _extended_hours_service
    if _extended_hours_service is None:
        _extended_hours_service = ExtendedHoursService()
    return _extended_hours_service
