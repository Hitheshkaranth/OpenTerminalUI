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
