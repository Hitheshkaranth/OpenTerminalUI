from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import httpx

from backend.adapters.base import DataAdapter, Instrument, OHLCV, QuoteResponse
from backend.core.crypto_adapter import CryptoAdapter
from backend.core.yahoo_client import YahooClient


class CryptoDataAdapter(DataAdapter):
    def __init__(self, yahoo: YahooClient | None = None) -> None:
        self.yahoo = yahoo or YahooClient()
        self._core = CryptoAdapter(self.yahoo)

    async def get_quote(self, symbol: str) -> QuoteResponse | None:
        s = symbol.strip().upper().replace("CRYPTO:", "")
        pair = s if "-" in s else f"{s}-USD"
        # Try CoinGecko simple price first.
        gecko_map = {
            "BTC-USD": "bitcoin",
            "ETH-USD": "ethereum",
            "SOL-USD": "solana",
            "BNB-USD": "binancecoin",
            "XRP-USD": "ripple",
        }
        coin_id = gecko_map.get(pair)
        if coin_id:
            try:
                async with httpx.AsyncClient(timeout=6.0, trust_env=False) as client:
                    resp = await client.get(
                        "https://api.coingecko.com/api/v3/simple/price",
                        params={"ids": coin_id, "vs_currencies": "usd", "include_24hr_change": "true"},
                    )
                    data = resp.json() if resp.status_code == 200 else {}
                    row = data.get(coin_id) if isinstance(data, dict) else {}
                    price = float(row.get("usd"))
                    chg = float(row.get("usd_24h_change") or 0.0)
                    return QuoteResponse(symbol=pair, price=price, change=0.0, change_pct=chg, currency="USD", ts=datetime.now(timezone.utc).isoformat())
            except Exception:
                pass
        rows = await self.yahoo.get_quotes([pair])
        row = rows[0] if rows else {}
        price = row.get("regularMarketPrice")
        if price is None:
            return None
        return QuoteResponse(
            symbol=pair,
            price=float(price),
            change=float(row.get("regularMarketChange") or 0.0),
            change_pct=float(row.get("regularMarketChangePercent") or 0.0),
            currency="USD",
            ts=datetime.now(timezone.utc).isoformat(),
        )

    async def get_history(self, symbol: str, timeframe: str, start: date, end: date) -> list[OHLCV]:
        s = symbol.strip().upper().replace("CRYPTO:", "")
        pair = s if "-" in s else f"{s}-USD"
        rng_days = max(1, (end - start).days)
        range_str = "1y" if rng_days > 220 else "6mo" if rng_days > 120 else "3mo" if rng_days > 45 else "1mo"
        row = await self._core.candles(pair, interval=timeframe or "1d", range_str=range_str)
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
        rows = self._core.search(query, limit=20)
        return [Instrument(symbol=r["symbol"], name=r["name"], exchange="CRYPTO", currency="USD") for r in rows]

    async def get_fundamentals(self, symbol: str) -> dict[str, Any]:
        return {"symbol": symbol.strip().upper(), "note": "Fundamentals unavailable for crypto adapter"}

    async def supports_streaming(self) -> bool:
        return False
