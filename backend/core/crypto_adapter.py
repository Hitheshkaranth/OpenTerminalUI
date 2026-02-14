from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.core.yahoo_client import YahooClient


@dataclass
class CryptoInstrument:
    id: str
    symbol: str
    name: str
    quote_symbol: str


class CryptoAdapter:
    def __init__(self, yahoo: YahooClient) -> None:
        self.yahoo = yahoo
        self._instruments: list[CryptoInstrument] = [
            CryptoInstrument(id="btc-usd", symbol="BTC-USD", name="Bitcoin", quote_symbol="BTC-USD"),
            CryptoInstrument(id="eth-usd", symbol="ETH-USD", name="Ethereum", quote_symbol="ETH-USD"),
            CryptoInstrument(id="sol-usd", symbol="SOL-USD", name="Solana", quote_symbol="SOL-USD"),
            CryptoInstrument(id="bnb-usd", symbol="BNB-USD", name="BNB", quote_symbol="BNB-USD"),
            CryptoInstrument(id="xrp-usd", symbol="XRP-USD", name="XRP", quote_symbol="XRP-USD"),
        ]

    def search(self, q: str, limit: int = 20) -> list[dict[str, str]]:
        term = q.strip().lower()
        rows = self._instruments
        if term:
            rows = [r for r in rows if term in r.symbol.lower() or term in r.name.lower() or term in r.id]
        return [{"id": r.id, "symbol": r.symbol, "name": r.name} for r in rows[: max(1, limit)]]

    async def candles(self, symbol: str, interval: str = "1d", range_str: str = "1y") -> dict[str, Any]:
        normalized = symbol.strip().upper()
        return await self.yahoo.get_chart(normalized, range_str=range_str, interval=interval)
