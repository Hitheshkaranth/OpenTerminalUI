from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from backend.services.crypto_market_service import CryptoMarketService


class _FakeCache:
    def __init__(self) -> None:
        self.data: dict[str, object] = {}

    def build_key(self, data_type: str, symbol: str, params: dict | None = None) -> str:
        return f"{data_type}:{symbol}:{params or {}}"

    async def get(self, key: str):
        return self.data.get(key)

    async def set(self, key: str, value, ttl: int = 300):  # noqa: ARG002
        self.data[key] = value


class _FakeYahoo:
    def __init__(self) -> None:
        self.quote_calls = 0

    async def get_quotes(self, symbols: list[str]):  # noqa: ARG002
        self.quote_calls += 1
        return [
            {
                "symbol": "BTC-USD",
                "regularMarketPrice": 50000,
                "regularMarketChangePercent": 2.1,
                "regularMarketVolume": 1000,
                "regularMarketDayHigh": 51000,
                "regularMarketDayLow": 49000,
            },
            {
                "symbol": "ETH-USD",
                "regularMarketPrice": 3000,
                "regularMarketChangePercent": -1.2,
                "regularMarketVolume": 800,
                "regularMarketDayHigh": 3200,
                "regularMarketDayLow": 2800,
            },
        ]

    async def get_chart(self, symbol: str, range_str: str = "1mo", interval: str = "1d"):  # noqa: ARG002
        return {
            "chart": {
                "result": [
                    {
                        "timestamp": [1735689600, 1735776000, 1735862400],
                        "indicators": {
                            "quote": [
                                {
                                    "open": [100, 101, 102],
                                    "high": [101, 102, 103],
                                    "low": [99, 100, 101],
                                    "close": [100.5, 101.5, 102.5],
                                    "volume": [10, 11, 12],
                                }
                            ]
                        },
                    }
                ]
            }
        }


class _FakeFetcher:
    def __init__(self, yahoo: _FakeYahoo) -> None:
        self.yahoo = yahoo


def test_crypto_service_market_cache_reuses_quotes() -> None:
    cache = _FakeCache()
    yahoo = _FakeYahoo()

    async def _fetcher():
        return _FakeFetcher(yahoo)

    service = CryptoMarketService(cache_backend=cache, fetcher_factory=_fetcher)
    first = asyncio.run(service.markets(limit=10))
    second = asyncio.run(service.markets(limit=10))

    assert first["items"]
    assert second["items"]
    assert yahoo.quote_calls == 1


def test_crypto_service_market_filter_and_sort() -> None:
    cache = _FakeCache()
    yahoo = _FakeYahoo()

    async def _fetcher():
        return _FakeFetcher(yahoo)

    service = CryptoMarketService(cache_backend=cache, fetcher_factory=_fetcher)
    result = asyncio.run(
        service.markets(
            limit=10,
            q="ETH",
            sector="L1",
            sort_by="change_24h",
            sort_order="asc",
        )
    )
    assert len(result["items"]) == 1
    assert result["items"][0]["symbol"] == "ETH-USD"


def test_crypto_service_coin_detail_shape() -> None:
    cache = _FakeCache()
    yahoo = _FakeYahoo()

    async def _fetcher():
        return _FakeFetcher(yahoo)

    service = CryptoMarketService(
        cache_backend=cache,
        fetcher_factory=_fetcher,
        now_factory=lambda: datetime(2026, 3, 5, tzinfo=timezone.utc),
    )
    detail = asyncio.run(service.coin_detail("btc"))
    assert detail is not None
    assert detail["symbol"] == "BTC-USD"
    assert detail["high_24h"] == 51000
    assert detail["low_24h"] == 49000
    assert detail["sparkline"] == [100.5, 101.5, 102.5]
