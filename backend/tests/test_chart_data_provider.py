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


def test_us_ohlcv_prefers_alpaca_before_other_providers(monkeypatch) -> None:
    monkeypatch.setenv("ALPACA_API_KEY", "key")
    monkeypatch.setenv("ALPACA_SECRET_KEY", "secret")
    provider = ChartDataProvider()

    sample = [
        OHLCVBar(
            timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
            open=10.0,
            high=11.0,
            low=9.5,
            close=10.8,
            volume=1000.0,
            symbol="AAPL",
            market="US",
        )
    ]

    async def _fake_alpaca(*args, **kwargs):  # noqa: ANN002, ANN003
        return sample

    async def _boom(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("fallback provider should not be called when alpaca returns bars")

    monkeypatch.setattr(provider, "_alpaca_historical", _fake_alpaca)
    monkeypatch.setattr(provider, "_fmp_historical", _boom)
    monkeypatch.setattr(provider, "_finnhub_candles", _boom)

    async def _run() -> None:
        bars = await provider._us_ohlcv("AAPL", "AAPL", "1m", "5d", None, None)
        assert len(bars) == 1
        assert bars[0].close == 10.8

    asyncio.run(_run())


def test_us_ohlcv_falls_back_when_alpaca_empty(monkeypatch) -> None:
    monkeypatch.setenv("ALPACA_API_KEY", "key")
    monkeypatch.setenv("ALPACA_SECRET_KEY", "secret")
    monkeypatch.setenv("FMP_API_KEY", "fmp-key")
    provider = ChartDataProvider()

    from_fmp = [
        OHLCVBar(
            timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc),
            open=20.0,
            high=21.0,
            low=19.5,
            close=20.4,
            volume=1500.0,
            symbol="MSFT",
            market="US",
        )
    ]

    async def _fake_alpaca(*args, **kwargs):  # noqa: ANN002, ANN003
        return []

    async def _fake_fmp(*args, **kwargs):  # noqa: ANN002, ANN003
        return from_fmp

    monkeypatch.setattr(provider, "_alpaca_historical", _fake_alpaca)
    monkeypatch.setattr(provider, "_fmp_historical", _fake_fmp)

    async def _run() -> None:
        bars = await provider._us_ohlcv("MSFT", "MSFT", "1m", "5d", None, None)
        assert len(bars) == 1
        assert bars[0].symbol == "MSFT"

    asyncio.run(_run())


def test_get_ohlcv_backfills_missing_ranges_from_provider(monkeypatch) -> None:
    provider = ChartDataProvider()
    start_dt = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end_dt = datetime(2026, 1, 1, 0, 4, tzinfo=timezone.utc)
    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)

    cached_rows = [
        {"t": start_ms, "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 100},
        {"t": start_ms + 60_000, "o": 10.5, "h": 11.2, "l": 10.1, "c": 11.0, "v": 120},
        {"t": start_ms + 180_000, "o": 11.2, "h": 11.4, "l": 10.8, "c": 11.0, "v": 90},
        {"t": end_ms, "o": 11.0, "h": 11.3, "l": 10.7, "c": 11.1, "v": 80},
    ]

    class _Result:
        def __init__(self):
            self.rows = cached_rows
            self.tier = "warm"
            self.complete = False
            self.missing_ranges = [(start_ms + 120_000, start_ms + 120_000)]

    async def _fake_get_range_with_gaps(*args, **kwargs):  # noqa: ANN002, ANN003
        return _Result()

    writes: list[list[dict[str, float | int]]] = []

    async def _fake_put_bars(symbol: str, interval: str, bars):  # noqa: ANN001, ANN202
        writes.append(bars)

    async def _fake_resolve(symbol: str, market_hint: str | None = None):  # noqa: ARG001
        return ("US", "AAPL", "AAPL")

    async def _fake_us(*args, **kwargs):  # noqa: ANN002, ANN003
        return [
            OHLCVBar(
                timestamp=datetime.fromtimestamp((start_ms + 120_000) / 1000, tz=timezone.utc),
                open=11.0,
                high=11.5,
                low=10.9,
                close=11.3,
                volume=110.0,
                symbol="AAPL",
                market="US",
            )
        ]

    monkeypatch.setattr(provider._cache, "get_range_with_gaps", _fake_get_range_with_gaps)
    monkeypatch.setattr(provider._cache, "put_bars", _fake_put_bars)
    monkeypatch.setattr(provider, "resolve_market", _fake_resolve)
    monkeypatch.setattr(provider, "_us_ohlcv", _fake_us)

    async def _run() -> None:
        bars = await provider.get_ohlcv("AAPL", interval="1m", start=start_dt, end=end_dt, market_hint="NASDAQ")
        assert len(bars) == 5
        assert any(abs(b.close - 11.3) < 1e-9 for b in bars)
        assert len(writes) == 1

    asyncio.run(_run())
