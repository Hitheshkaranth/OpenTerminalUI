from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from backend.api.routes import crypto
from backend.realtime.binance_ws import get_binance_derivatives_state


def _chart_payload(days: int = 8, start_price: float = 40000.0) -> dict:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    ts = [int((start + timedelta(days=i)).timestamp()) for i in range(days)]
    close = [start_price + i * 100 for i in range(days)]
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


def _quotes_payload() -> list[dict]:
    return [
        {"symbol": "BTC-USD", "regularMarketPrice": 50000, "regularMarketChangePercent": 2.1, "regularMarketVolume": 1000},
        {"symbol": "ETH-USD", "regularMarketPrice": 3000, "regularMarketChangePercent": 1.5, "regularMarketVolume": 800},
        {"symbol": "UNI-USD", "regularMarketPrice": 12, "regularMarketChangePercent": -1.2, "regularMarketVolume": 3200},
        {"symbol": "AAVE-USD", "regularMarketPrice": 95, "regularMarketChangePercent": 3.4, "regularMarketVolume": 700},
        {"symbol": "DOGE-USD", "regularMarketPrice": 0.18, "regularMarketChangePercent": -3.1, "regularMarketVolume": 25000},
    ]


def _patch_fetcher(monkeypatch) -> None:
    class _FakeYahoo:
        quote_calls = 0

        async def get_quotes(self, symbols: list[str]):  # noqa: ARG002
            self.quote_calls += 1
            return _quotes_payload()

        async def get_chart(self, symbol: str, range_str: str = "6mo", interval: str = "1d"):  # noqa: ARG002
            offset = 1000 if symbol == "ETH-USD" else 0
            return _chart_payload(start_price=40000 + offset)

    class _FakeFetcher:
        yahoo = _FakeYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(crypto, "get_unified_fetcher", _fake_get_unified_fetcher)
    monkeypatch.setattr(crypto.market_service, "_fetcher_factory", _fake_get_unified_fetcher)
    return _FakeFetcher.yahoo


def _clear_crypto_quote_cache(limit: int) -> None:
    key = crypto.cache_instance.build_key("crypto_quotes", "universe", {"limit": limit})
    stale_key = crypto.cache_instance.build_key("crypto_quotes", "universe_stale", {"limit": limit})

    crypto.cache_instance._l1_cache.pop(key, None)
    crypto.cache_instance._l1_cache.pop(stale_key, None)

    if crypto.cache_instance._redis:
        asyncio.run(crypto.cache_instance._redis.delete(key, stale_key))

    if crypto.cache_instance._db_conn:
        with crypto.cache_instance._db_lock:
            crypto.cache_instance._db_conn.execute("DELETE FROM cache WHERE key IN (?, ?)", (key, stale_key))
            crypto.cache_instance._db_conn.commit()


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
    assert len(result.data) == 8


def test_crypto_markets_returns_normalized_items(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    result = asyncio.run(crypto.crypto_markets(limit=10))
    assert "items" in result
    assert result["items"][0]["symbol"] in {"BTC-USD", "ETH-USD", "UNI-USD", "AAVE-USD", "DOGE-USD"}
    assert "count" in result


def test_crypto_markets_is_cache_aware(monkeypatch) -> None:
    fake_yahoo = _patch_fetcher(monkeypatch)
    _clear_crypto_quote_cache(limit=17)
    asyncio.run(crypto.crypto_markets(limit=17))
    asyncio.run(crypto.crypto_markets(limit=17))
    assert fake_yahoo.quote_calls == 1


def test_crypto_markets_supports_filter_and_sort(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    result = asyncio.run(crypto.crypto_markets(limit=10, q="eth", sector="l1", sort_by="change_24h", sort_order="asc"))
    assert len(result["items"]) == 1
    assert result["items"][0]["symbol"] == "ETH-USD"


def test_crypto_movers_gainers_sorted_desc(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    result = asyncio.run(crypto.crypto_movers(metric="gainers", limit=5))
    assert result["items"][0]["symbol"] == "AAVE-USD"


def test_crypto_dominance_fields_exist(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    result = asyncio.run(crypto.crypto_dominance())
    assert "btc_pct" in result and "eth_pct" in result and "others_pct" in result
    total = result["btc_pct"] + result["eth_pct"] + result["others_pct"]
    assert 99.0 <= total <= 101.0


def test_crypto_heatmap_has_buckets_and_depth(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    result = asyncio.run(crypto.crypto_heatmap(limit=5))
    assert len(result["items"]) >= 2
    first = result["items"][0]
    assert first["bucket"] in {"surge", "bullish", "up", "flat", "down", "bearish", "flush"}
    assert -1.0 <= float(first["depth_imbalance"]) <= 1.0
    assert float(first["depth_bid_notional"]) > 0
    assert float(first["depth_ask_notional"]) > 0


def test_crypto_derivatives_aggregates_liquidations(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    state = get_binance_derivatives_state()
    state.reset()

    result = asyncio.run(crypto.crypto_derivatives(limit=4))
    assert len(result["items"]) >= 2
    assert result["totals"]["liquidations_24h"] == (
        result["totals"]["long_liquidations_24h"] + result["totals"]["short_liquidations_24h"]
    )
    assert any(item["funding_rate_8h"] != 0 for item in result["items"])


def test_crypto_defi_dashboard_headline_and_protocols(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    result = asyncio.run(crypto.crypto_defi_dashboard())
    assert result["headline"]["tvl_usd"] > 0
    assert result["headline"]["dex_volume_24h"] > 0
    assert result["protocols"]
    assert all(row["symbol"].endswith("-USD") for row in result["protocols"])


def test_crypto_correlation_matrix_is_symmetric_and_bounded(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    result = asyncio.run(crypto.crypto_correlation_matrix(window=12, limit=4))
    symbols = result["symbols"]
    matrix = result["matrix"]
    assert len(symbols) == 4
    assert len(matrix) == 4

    for i in range(4):
        assert abs(float(matrix[i][i]) - 1.0) < 1e-9
        for j in range(4):
            val = float(matrix[i][j])
            assert -1.0 <= val <= 1.0
            assert abs(float(matrix[i][j]) - float(matrix[j][i])) < 1e-9


def test_crypto_coin_detail_shape(monkeypatch) -> None:
    _patch_fetcher(monkeypatch)
    detail = asyncio.run(crypto.crypto_coin_detail("btc"))
    assert detail["symbol"] == "BTC-USD"
    assert detail["name"] == "Bitcoin"
    assert "high_24h" in detail and "low_24h" in detail
    assert isinstance(detail["sparkline"], list)


def test_crypto_markets_uses_stale_cache_when_rate_limited(monkeypatch) -> None:
    class _RateLimitedYahoo:
        async def get_quotes(self, symbols: list[str]):  # noqa: ARG002
            raise RuntimeError("429 Too Many Requests")

    class _FakeFetcher:
        yahoo = _RateLimitedYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(crypto, "get_unified_fetcher", _fake_get_unified_fetcher)
    crypto.cache_instance._l1_cache.clear()
    stale_key = crypto.cache_instance.build_key("crypto_quotes", "universe_stale", {"limit": 12})
    asyncio.run(
        crypto.cache_instance.set(
            stale_key,
            [
                {
                    "symbol": "BTC-USD",
                    "name": "Bitcoin",
                    "price": 50000,
                    "change_24h": 1.5,
                    "volume_24h": 1000,
                    "market_cap": 50000000,
                    "sector": "L1",
                }
            ],
            ttl=300,
        )
    )

    result = asyncio.run(crypto.crypto_markets(limit=12))
    assert len(result["items"]) == 1
    assert result["items"][0]["symbol"] == "BTC-USD"
