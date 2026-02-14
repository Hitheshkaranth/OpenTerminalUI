from __future__ import annotations

import asyncio

from backend.api.routes import stocks


def test_top_tickers_returns_crude_gold_silver(monkeypatch) -> None:
    class _FakeYahoo:
        async def get_quotes(self, symbols):  # noqa: ANN001
            return [
                {"symbol": "CL=F", "regularMarketPrice": 78.3, "regularMarketChangePercent": 1.2},
                {"symbol": "GC=F", "regularMarketPrice": 2055.1, "regularMarketChangePercent": -0.4},
                {"symbol": "SI=F", "regularMarketPrice": 23.4, "regularMarketChangePercent": 0.3},
            ]

    class _FakeFetcher:
        yahoo = _FakeYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(stocks, "get_unified_fetcher", _fake_get_unified_fetcher)
    result = asyncio.run(stocks.get_top_bar_tickers())
    assert len(result.items) == 3
    assert [item.key for item in result.items] == ["crude", "gold", "silver"]
    assert result.items[0].price == 78.3
