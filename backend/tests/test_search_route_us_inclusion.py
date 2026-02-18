from __future__ import annotations

import asyncio
from dataclasses import dataclass

from backend.api.routes import search


@dataclass
class _Instrument:
    symbol: str
    name: str
    exchange: str


class _Adapter:
    def __init__(self, market: str):
        self.market = market

    async def search_instruments(self, q: str):
        if self.market == "NASDAQ":
            return [_Instrument(symbol="AAPL", name="Apple Inc", exchange="NASDAQ")]
        if self.market == "NYSE":
            return [_Instrument(symbol="IBM", name="IBM", exchange="NYSE")]
        if self.market == "NSE":
            return [_Instrument(symbol="INFY", name="Infosys", exchange="NSE")]
        return []


class _Registry:
    def get_adapter(self, market: str):
        return _Adapter(market)


class _Cls:
    def __init__(self, exchange: str, cc: str):
        self.exchange = exchange
        self.country_code = cc
        self.flag_emoji = ""


def test_search_includes_us_candidates_even_for_nse_market(monkeypatch) -> None:
    async def _fake_rows():
        return [
            {"Symbol": "INFY", "Company Name": "Infosys"},
        ]

    async def _fake_classify(ticker: str):
        t = ticker.upper()
        if t in {"AAPL", "IBM"}:
            return _Cls(exchange="NASDAQ" if t == "AAPL" else "NYSE", cc="US")
        return _Cls(exchange="NSE", cc="IN")

    monkeypatch.setattr(search, "_get_rows", _fake_rows)
    monkeypatch.setattr(search, "get_adapter_registry", lambda: _Registry())
    monkeypatch.setattr(search.market_classifier, "classify", _fake_classify)

    out = asyncio.run(search.search(q="app", market="NSE"))
    tickers = {row.ticker for row in out.results}

    assert "AAPL" in tickers
