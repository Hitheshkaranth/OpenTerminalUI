from __future__ import annotations

import asyncio

from backend.api.routes import stocks


def test_promoter_holdings_maps_and_sorts_history(monkeypatch) -> None:
    class _FakeFetcher:
        async def fetch_shareholding(self, ticker: str):  # noqa: ARG002
            return {
                "ticker": "RELIANCE",
                "history": [
                    {"date": "2025-Q2", "promoter": 50.2, "fii": 19.1, "dii": 13.7, "public": 17.0},
                    {"date": "2025-Q1", "promoter": 50.1, "fii": 18.9, "dii": 13.8, "public": 17.2},
                ],
            }

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(stocks, "get_unified_fetcher", _fake_get_unified_fetcher)

    result = asyncio.run(stocks.get_promoter_holdings("reliance"))
    assert result.symbol == "RELIANCE"
    assert len(result.history) == 2
    assert result.history[0].date == "2025-Q1"
    assert result.history[1].date == "2025-Q2"
    assert result.history[0].promoter == 50.1


def test_promoter_holdings_propagates_warning(monkeypatch) -> None:
    class _FakeFetcher:
        async def fetch_shareholding(self, ticker: str):  # noqa: ARG002
            return {"history": [], "warning": "fallback used"}

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(stocks, "get_unified_fetcher", _fake_get_unified_fetcher)
    result = asyncio.run(stocks.get_promoter_holdings("reliance"))
    assert result.warning == "fallback used"
