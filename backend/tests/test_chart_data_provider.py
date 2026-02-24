from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from backend.providers import chart_data
from backend.providers.chart_data import ChartDataProvider, OHLCVBar


def test_resolve_market_explicit_prefixes() -> None:
    provider = ChartDataProvider()

    async def _run() -> None:
        assert await provider.resolve_market("NSE:INFY") == ("IN", "INFY", "INFY.NS")
        assert await provider.resolve_market("BSE:TCS") == ("IN", "TCS", "TCS.BO")
        assert await provider.resolve_market("NASDAQ:TSLA") == ("US", "TSLA", "TSLA")
        assert await provider.resolve_market("NYSE:BAC") == ("US", "BAC", "BAC")

    asyncio.run(_run())


def test_resolve_market_uses_hint_before_classifier() -> None:
    provider = ChartDataProvider()

    async def _boom(symbol: str):  # noqa: ARG001
        raise AssertionError("classifier should not be called when hint is provided")

    original = chart_data.market_classifier.classify
    chart_data.market_classifier.classify = _boom  # type: ignore[assignment]
    try:
        async def _run() -> None:
            assert await provider.resolve_market("AAPL", market_hint="NASDAQ") == ("US", "AAPL", "AAPL")
            assert await provider.resolve_market("RELIANCE", market_hint="NSE") == ("IN", "RELIANCE", "RELIANCE.NS")

        asyncio.run(_run())
    finally:
        chart_data.market_classifier.classify = original  # type: ignore[assignment]


def test_get_ohlcv_prefers_in_memory_cache(monkeypatch) -> None:
    provider = ChartDataProvider()
    provider.chart_cache_ttl = 9999
    sample = [
        OHLCVBar(
            timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
            open=1,
            high=2,
            low=0.5,
            close=1.5,
            volume=10,
            symbol="AAPL",
            market="US",
        )
    ]

    async def _fake_resolve(symbol: str, market_hint: str | None = None):  # noqa: ARG001
        return ("US", "AAPL", "AAPL")

    calls = {"count": 0}

    async def _fake_us(*args, **kwargs):  # noqa: ANN002, ANN003
        calls["count"] += 1
        return sample

    monkeypatch.setattr(provider, "resolve_market", _fake_resolve)
    monkeypatch.setattr(provider, "_us_ohlcv", _fake_us)
    async def _fake_put_bars(*args, **kwargs):  # noqa: ANN002, ANN003
        return None

    monkeypatch.setattr(provider._cache, "put_bars", _fake_put_bars)

    async def _run() -> None:
        first = await provider.get_ohlcv("AAPL")
        second = await provider.get_ohlcv("AAPL")
        assert len(first) == 1
        assert len(second) == 1
        assert calls["count"] == 1

    asyncio.run(_run())
