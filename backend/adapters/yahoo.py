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
            company_name=row.get("shortName") or row.get("longName"),
        )

    async def get_history(self, symbol: str, timeframe: str, start: date, end: date) -> list[OHLCV]:
        rng_days = max(1, (end - start).days)
        # To provide at least 30m resolution for backtesting charts, request 30m or finer if within allowed Yahoo windows
        # Yahoo limits: 1m (7 days), 5m/15m/30m (60 days), 60m (730 days).
        # We will try '30m' for 60-day ranges, '60m' (or '1h') for up to 730 days, else '1d'.
        if timeframe in ["1d", "1wk", "1mo"]:
            interval_str = timeframe
        else:
            if rng_days <= 7:
                interval_str = timeframe if timeframe in ["1m", "5m", "15m", "30m", "60m", "1h"] else "1m"
            elif rng_days <= 60:
                interval_str = timeframe if timeframe in ["5m", "15m", "30m", "60m", "1h"] else "30m"
            elif rng_days <= 730:
                interval_str = timeframe if timeframe in ["60m", "1h"] else "1h"
            else:
                interval_str = "1d"

        range_str = "1y" if rng_days > 220 else "6mo" if rng_days > 120 else "3mo" if rng_days > 45 else "1mo"
        row = await self.yahoo.get_chart(symbol.strip().upper(), range_str=range_str, interval=interval_str)
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
        q = query.strip()
        if not q or len(q) < 2:
            return []

        results = await self.yahoo.search_symbols(q, limit=15)
        out = []
        for r in results:
            sym = r.get("symbol")
            if not sym:
                continue
            name = r.get("shortname") or r.get("longname") or sym
            exch = r.get("exchange") or self.exchange
            out.append(Instrument(symbol=sym, name=name, exchange=exch, currency="USD"))

        # Fallback to echo if no results found, to support direct ticker entry
        if not out and q.upper() == q and len(q) <= 5:
            return [Instrument(symbol=q.upper(), name=q.upper(), exchange=self.exchange, currency="USD")]

        return out

    async def get_fundamentals(self, symbol: str) -> dict[str, Any]:
        return await self.yahoo.get_quote_summary(symbol.strip().upper(), ["financialData", "summaryDetail", "defaultKeyStatistics", "assetProfile"])

    async def supports_streaming(self) -> bool:
        return False

    async def get_option_chain(self, underlying: str, expiry: date) -> OptionChain | None:
        return None

    async def get_futures_chain(self, underlying: str) -> list[FuturesContract]:
        return []
