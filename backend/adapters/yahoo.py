from __future__ import annotations

from datetime import date
from typing import Any

from backend.adapters.base import DataAdapter, FuturesContract, Instrument, OHLCV, OptionChain, QuoteResponse
from backend.core.yahoo_client import YahooClient


def _f(value: Any) -> float | None:
    try:
        out = float(value)
        return out if out == out else None
    except (TypeError, ValueError):
        return None


class YahooFinanceAdapter(DataAdapter):
    def __init__(self, yahoo: YahooClient | None = None, exchange: str = "NASDAQ") -> None:
        self.yahoo = yahoo or YahooClient()
        self.exchange = exchange

    async def get_quote(self, symbol: str) -> QuoteResponse | None:
        sym = symbol.strip().upper()
        rows = await self.yahoo.get_quotes([sym])
        row = rows[0] if rows else {}
        price = _f(row.get("regularMarketPrice"))
        if price is None:
            return None
        return QuoteResponse(
            symbol=sym,
            price=price,
            change=_f(row.get("regularMarketChange")) or 0.0,
            change_pct=_f(row.get("regularMarketChangePercent")) or 0.0,
            currency=str(row.get("currency") or "USD"),
        )

    async def get_history(self, symbol: str, timeframe: str, start: date, end: date) -> list[OHLCV]:
        rng_days = max(1, (end - start).days)
        range_str = "1y" if rng_days > 220 else "6mo" if rng_days > 120 else "3mo" if rng_days > 45 else "1mo"
        row = await self.yahoo.get_chart(symbol.strip().upper(), range_str=range_str, interval=timeframe or "1d")
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
        return [Instrument(symbol=q, name=q, exchange=self.exchange, currency="USD")]

    async def get_fundamentals(self, symbol: str) -> dict[str, Any]:
        return await self.yahoo.get_quote_summary(symbol.strip().upper(), ["financialData", "summaryDetail", "defaultKeyStatistics", "assetProfile"])

    async def supports_streaming(self) -> bool:
        return False

    async def get_option_chain(self, underlying: str, expiry: date) -> OptionChain | None:
        return None

    async def get_futures_chain(self, underlying: str) -> list[FuturesContract]:
        return []
