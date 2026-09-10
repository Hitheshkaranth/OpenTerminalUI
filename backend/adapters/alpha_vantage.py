from __future__ import annotations

import asyncio
import os
from datetime import date, datetime, timezone
from typing import Any

import httpx

from backend.adapters.base import DataAdapter, FuturesContract, Instrument, OHLCV, OptionChain, QuoteResponse


ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"
ALPHA_VANTAGE_URL_ALT = "https://alphavantage-paper.backpack.exchange/query"


def _coerce_float(value: Any) -> float | None:
    try:
        out = float(value)
        return out if out == out else None
    except (TypeError, ValueError):
        return None


class AlphaVantageAdapter(DataAdapter):
    def __init__(
        self,
        *,
        api_key: str | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.api_key = (api_key if api_key is not None else os.getenv("ALPHA_VANTAGE_API_KEY", "")).strip()

    @property
    def _enabled(self) -> bool:
        return bool(self.api_key)

    async def _request_json(
        self,
        *,
        function: str,
        params: dict[str, Any] | None = None,
        max_attempts: int = 3,
    ) -> dict[str, Any]:
        if not self._enabled:
            return {}
        for base_url in (ALPHA_VANTAGE_URL, ALPHA_VANTAGE_URL_ALT):
            attempt = 0
            while attempt < max_attempts:
                attempt += 1
                req_params: dict[str, Any] = {"function": function, "apikey": self.api_key}
                if params:
                    req_params.update(params)
                async with httpx.AsyncClient(base_url=base_url, timeout=15.0, trust_env=False) as client:
                    resp = await client.get("", params=req_params)
                if resp.status_code == 429:
                    await asyncio.sleep(min(1.5 * attempt, 5.0))
                    continue
                if resp.status_code == 401:
                    return {"error": {"message": "Invalid API key"}}
                if resp.status_code >= 400:
                    return {}
                try:
                    data = resp.json()
                    if isinstance(data, dict) and "Error Message" in data:
                        return {"error": {"message": data["Error Message"]}}
                    return data
                except Exception:
                    return {}
            return {}
        return {}

    async def get_quote(self, symbol: str) -> QuoteResponse | None:
        if not self._enabled:
            return None
        ticker = symbol.strip().upper()
        if not ticker:
            return None
        data = await self._request_json(
            function="QUOTE",
            params={"symbol": ticker},
        )
        if "error" in data:
            return None
        fields = {
            "01. symbol": "symbol",
            "02. open": "open",
            "03. high": "high",
            "04. low": "low",
            "05. price": "price",
            "06. volume": "volume",
            "08. previousClose": "previous_close",
            "09. change": "change",
            "10. change percent": "change_pct",
        }
        values: dict[str, float | None] = {}
        for av_key, py_key in fields.items():
            values[py_key] = _coerce_float(data.get(av_key))
        price = values.get("price")
        if price is None:
            return None
        prev_close = values.get("previous_close") or price
        change = values.get("change") or (price - prev_close)
        change_pct = values.get("change_pct") or 0.0
        return QuoteResponse(
            symbol=ticker,
            price=price,
            change=float(change),
            change_pct=float(change_pct),
            currency="USD",
            ts=datetime.now(timezone.utc).isoformat(),
        )

    async def get_history(self, symbol: str, timeframe: str, start: date, end: date) -> list[OHLCV]:
        return await self.get_historical_data(symbol, start, end, interval=timeframe)

    async def get_historical_data(
        self,
        symbol: str,
        start: date,
        end: date,
        *,
        interval: str = "1d",
        limit: int = 10_000,
    ) -> list[OHLCV]:
        if not self._enabled:
            return []
        ticker = symbol.strip().upper()
        if not ticker:
            return []
        tf = (interval or "1d").lower()
        if tf in ("1m", "2m", "5m", "15m", "30m", "60m", "1h", "4h"):
            function = "TIME_SERIES_INTRADAY"
            interval_param = f"{tf}" if tf in ("1m", "2m", "5m", "15m", "30m", "60m") else tf.replace("h", "min")
        else:
            function = "TIME_SERIES_DAILY"
            interval_param = "1day"
        params: dict[str, Any] = {"symbol": ticker, "interval": interval_param}
        if start:
            params["outputsize"] = "full"
        data = await self._request_json(
            function=function,
            params=params,
        )
        key_prefix = None
        if function == "TIME_SERIES_DAILY":
            key_prefix = "Time Series (Daily)"
        elif function == "TIME_SERIES_INTRADAY":
            for k in data:
                if k.startswith("Time Series ("):
                    key_prefix = k
                    break
        if key_prefix is None or key_prefix not in data:
            return []
        time_series = data[key_prefix]
        if not isinstance(time_series, dict):
            return []
        rows: list[OHLCV] = []
        timestamps = sorted(time_series.keys(), reverse=True)
        count = 0
        for ts_str in timestamps:
            if count >= limit:
                break
            point = time_series[ts_str]
            if not isinstance(point, dict):
                continue
            o = _coerce_float(point.get("1. open"))
            h = _coerce_float(point.get("2. high"))
            l = _coerce_float(point.get("3. low"))
            c = _coerce_float(point.get("4. close"))
            v = _coerce_float(point.get("5. volume")) or 0.0
            if o is None or h is None or l is None or c is None:
                continue
            try:
                ts_dt = datetime.fromisoformat(ts_str.replace(" ", "T"))
                ts_int = int(ts_dt.replace(tzinfo=timezone.utc).timestamp())
            except (ValueError, TypeError):
                continue
            rows.append(OHLCV(t=ts_int, o=float(o), h=float(h), l=float(l), c=float(c), v=float(v)))
            count += 1
        rows.sort(key=lambda r: r.t)
        return rows

    async def search_instruments(self, query: str) -> list[Instrument]:
        return [Instrument(symbol=query.strip().upper(), name=query.strip().upper(), exchange="US", currency="USD")]

    async def get_fundamentals(self, symbol: str) -> dict[str, Any]:
        return {}

    async def supports_streaming(self) -> bool:
        return False

    async def get_option_chain(self, underlying: str, expiry: date) -> OptionChain | None:
        return None

    async def get_futures_chain(self, underlying: str) -> list[FuturesContract]:
        return []