from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.providers import chart_data
from backend.providers.chart_data import ChartDataProvider, OHLCVBar


NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)


def bar(stamp: str, close: float = 100) -> OHLCVBar:
    return OHLCVBar(datetime.fromisoformat(stamp), close, close, close, close, 100, "AAPL", "US")


def provider(monkeypatch):
    monkeypatch.setattr(chart_data, "_now_utc", lambda: NOW)
    instance = ChartDataProvider()
    instance.resolve_market = AsyncMock(return_value=("US", "AAPL", "AAPL"))
    instance._cache = SimpleNamespace(put_bars=AsyncMock())
    return instance


def test_provider_full_history_cannot_be_cached_or_returned_as_six_months(monkeypatch):
    instance = provider(monkeypatch)
    old = bar("2021-11-15T00:00:00+00:00", 50)
    first = bar("2026-05-15T00:00:00+00:00", 100)
    last = bar("2026-11-13T00:00:00+00:00", 120)
    # Emulate an upstream endpoint that ignores date parameters and returns years.
    instance._us_ohlcv = AsyncMock(return_value=[old, first, last])

    async def run():
        full = await instance.get_ohlcv("AAPL", period="5y", market_hint="NASDAQ")
        short = await instance.get_ohlcv("AAPL", period="6mo", market_hint="NASDAQ")
        cached_short = await instance.get_ohlcv("AAPL", period="6mo", market_hint="NASDAQ")
        assert full == [old, first, last]
        assert short == cached_short == [first, last]
        assert (short[-1].close / short[0].close - 1) * 100 == pytest.approx(20)
        assert instance._us_ohlcv.await_count == 2
        args = instance._us_ohlcv.await_args_list[-1].args
        assert args[4] == datetime(2026, 5, 14, tzinfo=timezone.utc)
        assert args[5] == NOW
        written = instance._cache.put_bars.await_args_list[-1].args[2]
        assert len(written) == 2
        assert written[0]["t"] == int(first.timestamp.timestamp() * 1000)

    asyncio.run(run())


def test_preexisting_overwide_memory_entry_is_filtered_before_cache_return(monkeypatch):
    instance = provider(monkeypatch)
    old = bar("2021-11-15T00:00:00+00:00")
    recent = bar("2026-11-13T00:00:00+00:00")
    future = bar("2026-11-15T00:00:00+00:00")
    instance._mem_cache[("AAPL", "1d", "6mo|prepost=false")] = (time.time(), [old, recent, future])
    instance._us_ohlcv = AsyncMock(side_effect=AssertionError("Fresh memory entry should not refetch"))
    assert asyncio.run(instance.get_ohlcv("AAPL", period="6mo")) == [recent]


def test_explicit_bounds_preserve_timezone_and_time_of_day_on_fetch_and_return(monkeypatch):
    instance = provider(monkeypatch)
    start = datetime.fromisoformat("2026-01-05T14:30:00+05:30")
    end = datetime.fromisoformat("2026-01-05T15:30:00+05:30")
    inside = bar("2026-01-05T09:30:00+00:00")
    instance._us_ohlcv = AsyncMock(return_value=[bar("2026-01-05T08:59:00+00:00"), inside, bar("2026-01-05T10:01:00+00:00")])
    instance._cache.get_range_with_gaps = AsyncMock(return_value=SimpleNamespace(rows=[], complete=False, missing_ranges=[]))
    result = asyncio.run(instance.get_ohlcv("AAPL", interval="1m", period="5y", start=start, end=end))
    assert result == [inside]
    args = instance._us_ohlcv.await_args.args
    assert args[4] == start.astimezone(timezone.utc)
    assert args[5] == end.astimezone(timezone.utc)


def test_complete_tiered_cache_is_also_clipped_to_explicit_bounds(monkeypatch):
    instance = provider(monkeypatch)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 1, 2, tzinfo=timezone.utc)
    stamps = [datetime(2025, 12, 31, tzinfo=timezone.utc), start, end, datetime(2026, 1, 3, tzinfo=timezone.utc)]
    rows = [{"t": int(stamp.timestamp() * 1000), "o": 1, "h": 1, "l": 1, "c": 1} for stamp in stamps]
    instance._cache.get_range_with_gaps = AsyncMock(return_value=SimpleNamespace(rows=rows, complete=True, missing_ranges=[]))
    instance._us_ohlcv = AsyncMock(side_effect=AssertionError("Complete cache should not fetch"))
    result = asyncio.run(instance.get_ohlcv("AAPL", start=start, end=end))
    assert [item.timestamp for item in result] == [start, end]


def test_calendar_periods_and_end_only_requests_do_not_anchor_to_last_bar(monkeypatch):
    instance = provider(monkeypatch)
    assert chart_data._period_start("1mo", datetime(2024, 3, 31, tzinfo=timezone.utc)) == datetime(2024, 2, 29, tzinfo=timezone.utc)
    assert chart_data._period_start("ytd", NOW) == datetime(2026, 1, 1, tzinfo=timezone.utc)
    start, end = chart_data._requested_window("1d", "1mo", None, datetime(2024, 3, 31, 12, tzinfo=timezone.utc))
    assert start == datetime(2024, 2, 29, tzinfo=timezone.utc)
    assert end == datetime(2024, 3, 31, 12, tzinfo=timezone.utc)
    instance._us_ohlcv = AsyncMock(return_value=[bar("2000-01-01T00:00:00+00:00")])
    assert len(asyncio.run(instance.get_ohlcv("AAPL", period="max"))) == 1


def test_yfinance_receives_exact_datetime_bounds_not_date_only_strings(monkeypatch):
    instance = provider(monkeypatch)
    history = lambda **kwargs: captured.update(kwargs) or None
    captured = {}
    monkeypatch.setattr(chart_data.yf, "Ticker", lambda ticker: SimpleNamespace(history=history))
    start = datetime(2026, 1, 5, 9, 15, tzinfo=timezone.utc)
    end = datetime(2026, 1, 5, 10, 45, tzinfo=timezone.utc)
    asyncio.run(instance._yfinance_ohlcv("AAPL", "AAPL", "1m", "6mo", start, end, "US"))
    assert captured["start"] == start
    assert captured["end"] == end
    assert "period" not in captured
