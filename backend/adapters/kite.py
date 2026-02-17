from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from backend.adapters.base import DataAdapter, Instrument, OHLCV, QuoteResponse
from backend.core.kite_client import KiteClient
from backend.core.nse_client import NSEClient
from backend.core.yahoo_client import YahooClient


def _f(value: Any) -> float | None:
    try:
        out = float(value)
        return out if out == out else None
    except (TypeError, ValueError):
        return None


class KiteAdapter(DataAdapter):
    def __init__(self, kite: KiteClient | None = None, nse: NSEClient | None = None, yahoo: YahooClient | None = None) -> None:
        self.kite = kite or KiteClient()
        self.nse = nse or NSEClient()
        self.yahoo = yahoo or YahooClient()

    async def get_quote(self, symbol: str) -> QuoteResponse | None:
        token = self.kite.resolve_access_token()
        sym = symbol.strip().upper()
        if self.kite.api_key and token:
            row = await self.kite.get_quote(token, [f"NSE:{sym}"])
            data = row.get("data") if isinstance(row, dict) else {}
            q = data.get(f"NSE:{sym}") if isinstance(data, dict) else None
            if isinstance(q, dict):
                ltp = _f(q.get("last_price"))
                if ltp is not None:
                    ohlc = q.get("ohlc") if isinstance(q.get("ohlc"), dict) else {}
                    prev = _f(ohlc.get("close")) or 0.0
                    change = ltp - prev if prev else 0.0
                    cp = (change / prev * 100.0) if prev else 0.0
                    return QuoteResponse(symbol=sym, price=ltp, change=change, change_pct=cp, currency="INR", ts=datetime.now(timezone.utc).isoformat())
        row = await self.nse.get_quote_equity(sym)
        ltp = _f(((row or {}).get("priceInfo") or {}).get("lastPrice"))
        if ltp is not None:
            cp = _f(((row or {}).get("priceInfo") or {}).get("pChange")) or 0.0
            return QuoteResponse(symbol=sym, price=ltp, change=0.0, change_pct=cp, currency="INR", ts=datetime.now(timezone.utc).isoformat())
        return None

    async def get_history(self, symbol: str, timeframe: str, start: date, end: date) -> list[OHLCV]:
        rng_days = max(1, (end - start).days)
        range_str = "1y" if rng_days > 220 else "6mo" if rng_days > 120 else "3mo" if rng_days > 45 else "1mo"
        interval = timeframe or "1d"
        row = await self.yahoo.get_chart(f"{symbol.strip().upper()}.NS", range_str=range_str, interval=interval)
        chart = ((row or {}).get("chart") or {}).get("result") or []
        if not chart:
            return []
        payload = chart[0]
        timestamps = payload.get("timestamp") or []
        quote = (((payload.get("indicators") or {}).get("quote") or [{}])[0]) if isinstance(payload, dict) else {}
        out: list[OHLCV] = []
        for i, ts in enumerate(timestamps):
            try:
                o = quote.get("open", [])[i]
                h = quote.get("high", [])[i]
                l = quote.get("low", [])[i]
                c = quote.get("close", [])[i]
                v = quote.get("volume", [])[i] if i < len(quote.get("volume", [])) else 0
                if None in (o, h, l, c):
                    continue
                out.append(OHLCV(t=int(ts), o=float(o), h=float(h), l=float(l), c=float(c), v=float(v or 0)))
            except Exception:
                continue
        return out

    async def search_instruments(self, query: str) -> list[Instrument]:
        q = query.strip().upper()
        if not q:
            return []
        return [Instrument(symbol=q, name=q, exchange="NSE", currency="INR")]

    async def get_fundamentals(self, symbol: str) -> dict[str, Any]:
        row = await self.nse.get_quote_equity(symbol.strip().upper())
        return row if isinstance(row, dict) else {}

    async def supports_streaming(self) -> bool:
        return bool(self.kite.api_key and self.kite.resolve_access_token())
