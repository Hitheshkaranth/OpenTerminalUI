from __future__ import annotations

import asyncio
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from backend.adapters.base import DataAdapter, FuturesContract, Instrument, OHLCV, OptionChain, QuoteResponse

ALPACA_DATA_URL = "https://data.alpaca.markets/v2"
ALPACA_TRADING_URL = "https://paper-api.alpaca.markets/v2"


def _coerce_float(value: Any) -> float | None:
    try:
        out = float(value)
        return out if out == out else None
    except (TypeError, ValueError):
        return None


def _to_epoch_seconds(value: Any) -> int | None:
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        return int(ts)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    return None


def _map_timeframe(value: str) -> str:
    key = (value or "").strip().lower()
    mapping = {
        "1m": "1Min",
        "2m": "2Min",
        "3m": "3Min",
        "5m": "5Min",
        "15m": "15Min",
        "30m": "30Min",
        "1h": "1Hour",
        "60m": "1Hour",
        "4h": "4Hour",
        "1d": "1Day",
        "1wk": "1Week",
        "1w": "1Week",
        "1mo": "1Month",
    }
    return mapping.get(key, "1Day")


class AlpacaAdapter(DataAdapter):
    def __init__(
        self,
        *,
        api_key: str | None = None,
        secret_key: str | None = None,
        feed: str | None = None,
        adjustment: str | None = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else os.getenv("ALPACA_API_KEY", "")).strip()
        self.secret_key = (secret_key if secret_key is not None else os.getenv("ALPACA_SECRET_KEY", "")).strip()
        self.feed = (feed if feed is not None else os.getenv("ALPACA_FEED", "iex")).strip().lower() or "iex"
        self.adjustment = (adjustment if adjustment is not None else os.getenv("ALPACA_ADJUSTMENT", "raw")).strip().lower() or "raw"

    @property
    def _enabled(self) -> bool:
        return bool(self.api_key and self.secret_key)

    def _headers(self) -> dict[str, str]:
        return {
            "APCA-API-KEY-ID": self.api_key,
            "APCA-API-SECRET-KEY": self.secret_key,
        }

    async def _request_json(
        self,
        *,
        base_url: str,
        path: str,
        params: dict[str, Any] | None = None,
        max_attempts: int = 3,
    ) -> Any:
        if not self._enabled:
            return {}
        attempt = 0
        while attempt < max_attempts:
            attempt += 1
            async with httpx.AsyncClient(base_url=base_url, timeout=15.0, trust_env=False) as client:
                resp = await client.get(path, params=params, headers=self._headers())
            if resp.status_code == 429 and attempt < max_attempts:
                await asyncio.sleep(min(1.5 * attempt, 5.0))
                continue
            if resp.status_code >= 400:
                return {}
            return resp.json()
        return {}

    async def get_bars(
        self,
        symbol: str,
        timeframe: str,
        start: date | None = None,
        end: date | None = None,
        limit: int = 10_000,
    ) -> list[OHLCV]:
        if not self._enabled:
            return []
        ticker = symbol.strip().upper()
        if not ticker:
            return []
        tf = _map_timeframe(timeframe)
        if end is None:
            end_dt = datetime.now(timezone.utc)
        else:
            end_dt = datetime.combine(end, datetime.min.time(), tzinfo=timezone.utc)
        if start is None:
            start_dt = end_dt - timedelta(days=365)
        else:
            start_dt = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

        rows: list[OHLCV] = []
        next_page_token: str | None = None
        remaining = max(1, int(limit))
        while remaining > 0:
            page_limit = min(remaining, 10_000)
            params: dict[str, Any] = {
                "symbols": ticker,
                "timeframe": tf,
                "start": start_dt.isoformat().replace("+00:00", "Z"),
                "end": end_dt.isoformat().replace("+00:00", "Z"),
                "limit": page_limit,
                "sort": "asc",
                "feed": self.feed,
                "adjustment": self.adjustment,
            }
            if next_page_token:
                params["page_token"] = next_page_token
            payload = await self._request_json(base_url=ALPACA_DATA_URL, path="/stocks/bars", params=params)
            bars = ((payload.get("bars") or {}).get(ticker)) if isinstance(payload, dict) else None
            if not isinstance(bars, list) or not bars:
                break
            for row in bars:
                if not isinstance(row, dict):
                    continue
                ts = _to_epoch_seconds(row.get("t"))
                o = _coerce_float(row.get("o"))
                h = _coerce_float(row.get("h"))
                l = _coerce_float(row.get("l"))
                c = _coerce_float(row.get("c"))
                v = _coerce_float(row.get("v")) or 0.0
                if ts is None or None in (o, h, l, c):
                    continue
                rows.append(OHLCV(t=ts, o=float(o), h=float(h), l=float(l), c=float(c), v=float(v)))
            remaining = limit - len(rows)
            next_page_token = payload.get("next_page_token") if isinstance(payload, dict) else None
            if not next_page_token:
                break
        rows.sort(key=lambda r: r.t)
        return rows[:limit]

    async def get_snapshot(self, symbols: list[str]) -> dict[str, QuoteResponse]:
        out: dict[str, QuoteResponse] = {}
        if not self._enabled:
            return out
        tickers = [s.strip().upper() for s in symbols if isinstance(s, str) and s.strip()]
        if not tickers:
            return out
        payload = await self._request_json(
            base_url=ALPACA_DATA_URL,
            path="/stocks/snapshots",
            params={"symbols": ",".join(tickers), "feed": self.feed},
        )
        snapshots = payload.get("snapshots") if isinstance(payload, dict) else None
        if not isinstance(snapshots, dict):
            return out
        for ticker, snap in snapshots.items():
            if not isinstance(snap, dict):
                continue
            latest_trade = snap.get("latestTrade") if isinstance(snap.get("latestTrade"), dict) else {}
            daily_bar = snap.get("dailyBar") if isinstance(snap.get("dailyBar"), dict) else {}
            price = _coerce_float(latest_trade.get("p")) or _coerce_float(daily_bar.get("c"))
            if price is None:
                continue
            prev_close = _coerce_float(daily_bar.get("o")) or price
            change = float(price - prev_close)
            pct = (change / prev_close * 100.0) if prev_close else 0.0
            out[ticker] = QuoteResponse(
                symbol=ticker,
                price=float(price),
                change=change,
                change_pct=pct,
                currency="USD",
                ts=str(latest_trade.get("t") or ""),
            )
        return out

    async def get_quote(self, symbol: str) -> QuoteResponse | None:
        ticker = symbol.strip().upper()
        snap = await self.get_snapshot([ticker])
        return snap.get(ticker)

    async def get_history(self, symbol: str, timeframe: str, start: date, end: date) -> list[OHLCV]:
        return await self.get_bars(symbol=symbol, timeframe=timeframe, start=start, end=end, limit=10_000)

    async def search_symbols(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        if not self._enabled:
            return []
        q = query.strip().upper()
        if len(q) < 1:
            return []
        payload = await self._request_json(
            base_url=ALPACA_TRADING_URL,
            path="/assets",
            params={"status": "active", "asset_class": "us_equity"},
        )
        rows = payload if isinstance(payload, list) else []
        out: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            sym = str(row.get("symbol") or "").upper()
            if not sym or q not in sym:
                continue
            out.append(
                {
                    "symbol": sym,
                    "name": row.get("name") or sym,
                    "exchange": row.get("exchange") or "US",
                    "currency": "USD",
                }
            )
            if len(out) >= limit:
                break
        return out

    async def search_instruments(self, query: str) -> list[Instrument]:
        rows = await self.search_symbols(query, limit=20)
        return [
            Instrument(
                symbol=str(r.get("symbol") or ""),
                name=str(r.get("name") or r.get("symbol") or ""),
                exchange=str(r.get("exchange") or "US"),
                currency="USD",
            )
            for r in rows
            if str(r.get("symbol") or "")
        ]

    async def get_fundamentals(self, symbol: str) -> dict[str, Any]:
        return {}

    async def supports_streaming(self) -> bool:
        return self._enabled

    async def get_option_chain(self, underlying: str, expiry: date) -> OptionChain | None:  # noqa: ARG002
        return None

    async def get_futures_chain(self, underlying: str) -> list[FuturesContract]:  # noqa: ARG002
        return []
