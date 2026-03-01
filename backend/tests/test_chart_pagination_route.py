from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from backend.api.routes import chart


def _build_chart_payload(points: int = 12) -> dict:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    timestamps: list[int] = []
    opens: list[float] = []
    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []
    volumes: list[int] = []
    for i in range(points):
        ts = int((start + timedelta(days=i)).timestamp())
        base = 100.0 + i
        timestamps.append(ts)
        opens.append(base)
        highs.append(base + 2.0)
        lows.append(base - 2.0)
        closes.append(base + 1.0)
        volumes.append(1000 + i)
    return {
        "chart": {
            "result": [
                {
                    "timestamp": timestamps,
                    "indicators": {
                        "quote": [
                            {
                                "open": opens,
                                "high": highs,
                                "low": lows,
                                "close": closes,
                                "volume": volumes,
                            }
                        ]
                    },
                }
            ]
        }
    }


def test_chart_limit_returns_latest_window(monkeypatch) -> None:
    class _FakeFetcher:
        async def fetch_history(self, ticker: str, range_str: str = "1y", interval: str = "1d"):  # noqa: ARG002
            return _build_chart_payload(points=12)

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    async def _fake_cache_get(key: str):  # noqa: ARG001
        return None

    async def _fake_cache_set(key: str, payload, ttl: int):  # noqa: ANN001, ARG001
        return None

    monkeypatch.setattr(chart, "get_unified_fetcher", _fake_get_unified_fetcher)
    monkeypatch.setattr(chart.cache_instance, "get", _fake_cache_get)
    monkeypatch.setattr(chart.cache_instance, "set", _fake_cache_set)

    result = asyncio.run(chart.get_chart("RELIANCE", interval="1d", range="1y", limit=5, cursor=None))
    assert len(result.data) == 5
    assert result.data[0].t < result.data[-1].t
    assert result.meta.pagination is not None
    assert result.meta.pagination["has_more"] is True
    assert result.meta.pagination["cursor"] == result.data[0].t


def test_chart_cursor_moves_window_backward(monkeypatch) -> None:
    class _FakeFetcher:
        async def fetch_history(self, ticker: str, range_str: str = "1y", interval: str = "1d"):  # noqa: ARG002
            return _build_chart_payload(points=10)

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    async def _fake_cache_get(key: str):  # noqa: ARG001
        return None

    async def _fake_cache_set(key: str, payload, ttl: int):  # noqa: ANN001, ARG001
        return None

    monkeypatch.setattr(chart, "get_unified_fetcher", _fake_get_unified_fetcher)
    monkeypatch.setattr(chart.cache_instance, "get", _fake_cache_get)
    monkeypatch.setattr(chart.cache_instance, "set", _fake_cache_set)

    first = asyncio.run(chart.get_chart("RELIANCE", interval="1d", range="1y", limit=4, cursor=None))
    cursor = first.meta.pagination["cursor"]
    second = asyncio.run(chart.get_chart("RELIANCE", interval="1d", range="1y", limit=4, cursor=cursor))

    assert len(first.data) == 4
    assert len(second.data) == 4
    assert second.data[-1].t < first.data[0].t


def test_chart_legacy_route_uses_synthetic_fallback_when_history_empty(monkeypatch) -> None:
    class _FakeFetcher:
        async def fetch_history(self, ticker: str, range_str: str = "1y", interval: str = "1d"):  # noqa: ARG002
            return {}

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    async def _fake_cache_get(key: str):  # noqa: ARG001
        return None

    async def _fake_cache_set(key: str, payload, ttl: int):  # noqa: ANN001, ARG001
        return None

    monkeypatch.setattr(chart, "get_unified_fetcher", _fake_get_unified_fetcher)
    monkeypatch.setattr(chart.cache_instance, "get", _fake_cache_get)
    monkeypatch.setattr(chart.cache_instance, "set", _fake_cache_set)

    result = asyncio.run(chart.get_chart("RELIANCE", interval="1d", range="1y", limit=10, cursor=None))

    assert result.ticker == "RELIANCE"
    assert len(result.data) == 10
    assert result.meta.warnings
    assert result.meta.warnings[0].code == "chart_data_fallback"
