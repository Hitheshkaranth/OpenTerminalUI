from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx
import yfinance as yf

from backend.db.ohlcv_cache import get_ohlcv_cache
from backend.services.instrument_map import get_instrument_map_service
from backend.shared.market_classifier import market_classifier

logger = logging.getLogger(__name__)

MarketType = Literal["IN", "US"]
IN_EXCHANGES = {"NSE", "BSE", "NFO"}
US_EXCHANGES = {"NYSE", "NASDAQ", "AMEX"}


@dataclass
class OHLCVBar:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    symbol: str
    market: MarketType


def _utc_dt(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _parse_iso_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return _utc_dt(datetime.fromisoformat(text))
    except ValueError:
        return None


class ChartDataProvider:
    def __init__(self) -> None:
        self.fmp_key = os.getenv("FMP_API_KEY", "").strip()
        self.finnhub_key = os.getenv("FINNHUB_API_KEY", "").strip()
        self.chart_cache_ttl = int(os.getenv("CHART_CACHE_TTL", "900") or "900")
        self._mem_cache: dict[tuple[str, str, str], tuple[float, list[OHLCVBar]]] = {}
        self._cache = get_ohlcv_cache()

    async def resolve_market(self, symbol: str, market_hint: str | None = None) -> tuple[MarketType, str, str]:
        raw = (symbol or "").strip().upper()
        if not raw:
            return ("US", "", "")
        if ":" in raw:
            exchange, ticker = raw.split(":", 1)
            exchange = exchange.strip().upper()
            ticker = ticker.strip().upper()
            if exchange in IN_EXCHANGES:
                suffix = ".BO" if exchange == "BSE" else ".NS"
                return ("IN", ticker, f"{ticker}{suffix}")
            if exchange in US_EXCHANGES:
                return ("US", ticker, ticker)
        if raw.endswith(".NS"):
            return ("IN", raw[:-3], raw)
        if raw.endswith(".BO"):
            return ("IN", raw[:-3], raw)

        hint = (market_hint or "").strip().upper()
        if hint in IN_EXCHANGES:
            suffix = ".BO" if hint == "BSE" else ".NS"
            return ("IN", raw, f"{raw}{suffix}")
        if hint in US_EXCHANGES:
            return ("US", raw, raw)

        try:
            cls = await market_classifier.classify(raw)
            if cls.country_code == "IN":
                suffix = ".BO" if cls.exchange == "BSE" else ".NS"
                return ("IN", cls.symbol.upper(), f"{cls.symbol.upper()}{suffix}")
            return ("US", cls.symbol.upper(), cls.symbol.upper())
        except Exception:
            # Conservative fallback: suffix-less symbols are more common in US.
            return ("US", raw, raw)

    async def get_ohlcv(
        self,
        symbol: str,
        interval: str = "1d",
        period: str = "6mo",
        start: datetime | None = None,
        end: datetime | None = None,
        market_hint: str | None = None,
        prepost: bool = False,
    ) -> list[OHLCVBar]:
        period = self._normalize_default_period_for_interval(interval, period, start, end)
        market, base_symbol, provider_ticker = await self.resolve_market(symbol, market_hint=market_hint)
        if not provider_ticker:
            return []

        start = _utc_dt(start) if start else None
        end = _utc_dt(end) if end else None
        cache_period_key = f"{period}|prepost={str(bool(prepost)).lower()}"
        cache_key = (provider_ticker, interval, cache_period_key)
        now = time.time()
        if start is None and end is None:
            cached = self._mem_cache.get(cache_key)
            if cached and (now - cached[0]) < self.chart_cache_ttl:
                return list(cached[1])

        # SQLite cache lookup only for explicit ranges.
        if start and end and not prepost:
            cached_rows = await self._cache.get_range(
                provider_ticker,
                interval,
                int(start.timestamp() * 1000),
                int(end.timestamp() * 1000),
            )
            if cached_rows:
                return [
                    OHLCVBar(
                        timestamp=datetime.fromtimestamp(r["t"] / 1000, tz=timezone.utc),
                        open=float(r["o"]),
                        high=float(r["h"]),
                        low=float(r["l"]),
                        close=float(r["c"]),
                        volume=float(r.get("v", 0)),
                        symbol=base_symbol,
                        market=market,
                    )
                    for r in cached_rows
                ]

        if market == "IN":
            bars = await self._india_ohlcv(base_symbol, provider_ticker, interval, period, start, end)
        else:
            bars = await self._us_ohlcv(base_symbol, provider_ticker, interval, period, start, end, prepost=prepost)

        if bars:
            normalized = [
                {
                    "t": int(_utc_dt(b.timestamp).timestamp() * 1000),
                    "o": b.open,
                    "h": b.high,
                    "l": b.low,
                    "c": b.close,
                    "v": b.volume,
                }
                for b in bars
            ]
            if not prepost:
                await self._cache.put_bars(provider_ticker, interval, normalized)
            if start is None and end is None:
                self._mem_cache[cache_key] = (now, list(bars))
        return bars

    def _normalize_default_period_for_interval(
        self,
        interval: str,
        period: str,
        start: datetime | None,
        end: datetime | None,
    ) -> str:
        # yfinance rejects long lookbacks for intraday bars (especially 1m).
        # Most callers rely on the function default period, so clamp only in that case.
        if start or end:
            return period
        normalized_interval = (interval or "1d").strip().lower()
        normalized_period = (period or "6mo").strip().lower()
        if normalized_period != "6mo":
            return period
        if normalized_interval == "1m":
            return "7d"
        if normalized_interval in {"2m", "5m", "15m", "30m", "60m", "1h", "90m"}:
            return "60d"
        return period

    async def _india_ohlcv(
        self,
        base_symbol: str,
        ticker: str,
        interval: str,
        period: str,
        start: datetime | None,
        end: datetime | None,
    ) -> list[OHLCVBar]:
        try:
            bars = await self._kite_historical(base_symbol, ticker, interval, start, end)
            if bars:
                return bars
        except Exception as exc:
            logger.warning("Kite historical failed for %s: %s", ticker, exc)
        return await self._yfinance_ohlcv(base_symbol, ticker, interval, period, start, end, market="IN")

    async def _us_ohlcv(
        self,
        base_symbol: str,
        ticker: str,
        interval: str,
        period: str,
        start: datetime | None,
        end: datetime | None,
        prepost: bool = False,
    ) -> list[OHLCVBar]:
        if self.fmp_key:
            try:
                bars = await self._fmp_historical(base_symbol, ticker, interval, start, end)
                if bars:
                    return bars
            except Exception as exc:
                logger.warning("FMP historical failed for %s: %s", ticker, exc)
        if self.finnhub_key:
            try:
                bars = await self._finnhub_candles(base_symbol, ticker, interval, start, end)
                if bars:
                    return bars
            except Exception as exc:
                logger.warning("Finnhub candles failed for %s: %s", ticker, exc)
        return await self._yfinance_ohlcv(base_symbol, ticker, interval, period, start, end, market="US", prepost=prepost)

    async def _yfinance_ohlcv(
        self,
        base_symbol: str,
        ticker: str,
        interval: str,
        period: str,
        start: datetime | None,
        end: datetime | None,
        market: MarketType,
        prepost: bool = False,
    ) -> list[OHLCVBar]:
        def _fetch():
            t = yf.Ticker(ticker)
            kwargs: dict[str, str] = {"interval": interval}
            interval_lower = str(interval or "").strip().lower()
            is_intraday = interval_lower.endswith("m") or interval_lower.endswith("h")
            if market == "US" and prepost and is_intraday:
                kwargs["prepost"] = True
            if start and end:
                kwargs["start"] = start.strftime("%Y-%m-%d")
                kwargs["end"] = end.strftime("%Y-%m-%d")
            else:
                kwargs["period"] = period
            return t.history(**kwargs)

        df = await asyncio.to_thread(_fetch)
        if df is None or getattr(df, "empty", True):
            return []
        bars: list[OHLCVBar] = []
        for ts, row in df.iterrows():
            dt = ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts
            dt = _utc_dt(dt)
            try:
                bars.append(
                    OHLCVBar(
                        timestamp=dt,
                        open=float(row["Open"]),
                        high=float(row["High"]),
                        low=float(row["Low"]),
                        close=float(row["Close"]),
                        volume=float(row.get("Volume", 0) or 0),
                        symbol=base_symbol,
                        market=market,
                    )
                )
            except Exception:
                continue
        bars.sort(key=lambda b: b.timestamp)
        return bars

    async def _fmp_historical(
        self,
        base_symbol: str,
        ticker: str,
        interval: str,
        start: datetime | None,
        end: datetime | None,
    ) -> list[OHLCVBar]:
        if not self.fmp_key:
            return []
        fmp_interval_map = {
            "1m": "1min",
            "5m": "5min",
            "15m": "15min",
            "30m": "30min",
            "1h": "1hour",
            "4h": "4hour",
            "1d": "daily",
        }
        mode = fmp_interval_map.get(interval, "daily")
        if mode == "daily":
            url = f"https://financialmodelingprep.com/api/v3/historical-price-full/{ticker}"
        else:
            url = f"https://financialmodelingprep.com/api/v3/historical-chart/{mode}/{ticker}"
        params: dict[str, str] = {"apikey": self.fmp_key}
        if start:
            params["from"] = start.strftime("%Y-%m-%d")
        if end:
            params["to"] = end.strftime("%Y-%m-%d")
        async with httpx.AsyncClient(timeout=15.0, trust_env=False) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        records = data.get("historical", []) if isinstance(data, dict) else data if isinstance(data, list) else []
        bars: list[OHLCVBar] = []
        for row in records:
            if not isinstance(row, dict):
                continue
            dt = _parse_iso_dt(str(row.get("date") or row.get("formattedDate") or ""))
            if not dt:
                continue
            try:
                bars.append(
                    OHLCVBar(
                        timestamp=dt,
                        open=float(row["open"]),
                        high=float(row["high"]),
                        low=float(row["low"]),
                        close=float(row["close"]),
                        volume=float(row.get("volume", 0) or 0),
                        symbol=base_symbol,
                        market="US",
                    )
                )
            except Exception:
                continue
        bars.sort(key=lambda b: b.timestamp)
        return bars

    async def _finnhub_candles(
        self,
        base_symbol: str,
        ticker: str,
        interval: str,
        start: datetime | None,
        end: datetime | None,
    ) -> list[OHLCVBar]:
        if not self.finnhub_key:
            return []
        resolution_map = {
            "1m": "1",
            "5m": "5",
            "15m": "15",
            "30m": "30",
            "1h": "60",
            "4h": "240",
            "1d": "D",
            "1wk": "W",
            "1mo": "M",
        }
        resolution = resolution_map.get(interval, "D")
        _end = end or datetime.now(timezone.utc)
        _start = start or (_end - timedelta(days=180))
        async with httpx.AsyncClient(timeout=15.0, trust_env=False) as client:
            resp = await client.get(
                "https://finnhub.io/api/v1/stock/candle",
                params={
                    "symbol": ticker,
                    "resolution": resolution,
                    "from": int(_start.timestamp()),
                    "to": int(_end.timestamp()),
                    "token": self.finnhub_key,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        if not isinstance(data, dict) or data.get("s") != "ok":
            return []
        out: list[OHLCVBar] = []
        ts_list = data.get("t") or []
        for i, ts in enumerate(ts_list):
            try:
                out.append(
                    OHLCVBar(
                        timestamp=datetime.fromtimestamp(int(ts), tz=timezone.utc),
                        open=float(data["o"][i]),
                        high=float(data["h"][i]),
                        low=float(data["l"][i]),
                        close=float(data["c"][i]),
                        volume=float((data.get("v") or [0])[i] or 0),
                        symbol=base_symbol,
                        market="US",
                    )
                )
            except Exception:
                continue
        return out

    async def _kite_historical(
        self,
        base_symbol: str,
        ticker: str,
        interval: str,
        start: datetime | None,
        end: datetime | None,
    ) -> list[OHLCVBar]:
        from backend.api.deps import get_unified_fetcher

        fetcher = await get_unified_fetcher()
        kite = fetcher.kite
        access_token = kite.resolve_access_token()
        if not kite.api_key or not access_token:
            return []

        exchange = "BSE" if ticker.endswith(".BO") else "NSE"
        instrument_map = get_instrument_map_service()
        mapping = await instrument_map.resolve_many([f"{exchange}:{base_symbol}"])
        instrument_token = mapping.get(f"{exchange}:{base_symbol}")
        if not instrument_token:
            return []

        kite_interval_map = {
            "1m": "minute",
            "5m": "5minute",
            "15m": "15minute",
            "30m": "30minute",
            "1h": "60minute",
            "1d": "day",
        }
        kite_interval = kite_interval_map.get(interval)
        if not kite_interval:
            return []

        _end = end or datetime.now(timezone.utc)
        _start = start or (_end - timedelta(days=60 if interval != "1d" else 365))
        payload = await kite.get_historical_data(access_token, int(instrument_token), _start, _end, kite_interval)
        rows = payload.get("data") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            return []
        out: list[OHLCVBar] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            dt = row.get("date")
            if isinstance(dt, str):
                parsed = _parse_iso_dt(dt)
                dt = parsed if parsed else None
            elif isinstance(dt, datetime):
                dt = _utc_dt(dt)
            else:
                dt = None
            if not dt:
                continue
            try:
                out.append(
                    OHLCVBar(
                        timestamp=dt,
                        open=float(row["open"]),
                        high=float(row["high"]),
                        low=float(row["low"]),
                        close=float(row["close"]),
                        volume=float(row.get("volume", 0) or 0),
                        symbol=base_symbol,
                        market="IN",
                    )
                )
            except Exception:
                continue
        out.sort(key=lambda b: b.timestamp)
        return out


_chart_provider: ChartDataProvider | None = None
_chart_provider_lock = asyncio.Lock()


async def get_chart_data_provider() -> ChartDataProvider:
    global _chart_provider
    if _chart_provider is not None:
        return _chart_provider
    async with _chart_provider_lock:
        if _chart_provider is None:
            _chart_provider = ChartDataProvider()
        return _chart_provider
