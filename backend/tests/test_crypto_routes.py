from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from backend.api.routes import crypto


def _chart_payload(days: int = 5) -> dict:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    ts = [int((start + timedelta(days=i)).timestamp()) for i in range(days)]
    close = [40000 + i * 100 for i in range(days)]
    return {
        "chart": {
            "result": [
                {
                    "timestamp": ts,
                    "indicators": {
                        "quote": [
                            {
                                "open": close,
                                "high": [c + 50 for c in close],
                                "low": [c - 50 for c in close],
                                "close": close,
                                "volume": [1000 + i for i in range(days)],
                            }
                        ]
                    },
                }
            ]
        }
    }


def test_crypto_search_returns_matches(monkeypatch) -> None:
    class _FakeYahoo:
        pass

    class _FakeFetcher:
        yahoo = _FakeYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(crypto, "get_unified_fetcher", _fake_get_unified_fetcher)
    result = asyncio.run(crypto.search_crypto(q="btc", limit=10))
    assert any(item["symbol"] == "BTC-USD" for item in result["items"])


def test_crypto_candles_returns_chart_response(monkeypatch) -> None:
    class _FakeYahoo:
        async def get_chart(self, symbol: str, range_str: str = "1y", interval: str = "1d"):  # noqa: ARG002
            return _chart_payload()

    class _FakeFetcher:
        yahoo = _FakeYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(crypto, "get_unified_fetcher", _fake_get_unified_fetcher)
    result = asyncio.run(crypto.crypto_candles(symbol="BTC-USD", interval="1d", range="1y"))
    assert result.ticker == "BTC-USD"
    assert len(result.data) == 5


def test_crypto_markets_returns_normalized_items(monkeypatch) -> None:
    class _FakeYahoo:
        async def get_quotes(self, symbols: list[str]):  # noqa: ARG002
            return [
                {"symbol": "BTC-USD", "regularMarketPrice": 50000, "regularMarketChangePercent": 2.1, "regularMarketVolume": 1000},
                {"symbol": "ETH-USD", "regularMarketPrice": 3000, "regularMarketChangePercent": 1.5, "regularMarketVolume": 800},
            ]

    class _FakeFetcher:
        yahoo = _FakeYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(crypto, "get_unified_fetcher", _fake_get_unified_fetcher)
    result = asyncio.run(crypto.crypto_markets(limit=10))
    assert "items" in result
    assert result["items"][0]["symbol"] in {"BTC-USD", "ETH-USD"}


def test_crypto_movers_gainers_sorted_desc(monkeypatch) -> None:
    class _FakeYahoo:
        async def get_quotes(self, symbols: list[str]):  # noqa: ARG002
            return [
                {"symbol": "BTC-USD", "regularMarketPrice": 50000, "regularMarketChangePercent": 0.8, "regularMarketVolume": 1000},
                {"symbol": "ETH-USD", "regularMarketPrice": 3000, "regularMarketChangePercent": 3.2, "regularMarketVolume": 800},
            ]

    class _FakeFetcher:
        yahoo = _FakeYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(crypto, "get_unified_fetcher", _fake_get_unified_fetcher)
    result = asyncio.run(crypto.crypto_movers(metric="gainers", limit=5))
    assert result["items"][0]["symbol"] == "ETH-USD"


def test_crypto_dominance_fields_exist(monkeypatch) -> None:
    class _FakeYahoo:
        async def get_quotes(self, symbols: list[str]):  # noqa: ARG002
            return [
                {"symbol": "BTC-USD", "regularMarketPrice": 50000, "regularMarketChangePercent": 0.8, "regularMarketVolume": 1000},
                {"symbol": "ETH-USD", "regularMarketPrice": 3000, "regularMarketChangePercent": 3.2, "regularMarketVolume": 800},
            ]

    class _FakeFetcher:
        yahoo = _FakeYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(crypto, "get_unified_fetcher", _fake_get_unified_fetcher)
    result = asyncio.run(crypto.crypto_dominance())
    assert "btc_pct" in result and "eth_pct" in result and "others_pct" in result
    total = result["btc_pct"] + result["eth_pct"] + result["others_pct"]
    assert 99.0 <= total <= 101.0
