from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from backend.api.routes import chart
from backend.providers.chart_data import OHLCVBar


def test_chart_route_normalized_returns_unified_payload(monkeypatch) -> None:
    calls: dict[str, object] = {}

    class _FakeProvider:
        async def get_ohlcv(self, *args, **kwargs):  # noqa: ANN002, ANN003
            calls["args"] = args
            calls["kwargs"] = kwargs
            return [
                OHLCVBar(
                    timestamp=datetime(2026, 2, 24, 10, 0, tzinfo=timezone.utc),
                    open=10,
                    high=12,
                    low=9,
                    close=11,
                    volume=123,
                    symbol="AAPL",
                    market="US",
                )
            ]

    async def _fake_get_chart_provider():
        return _FakeProvider()

    monkeypatch.setattr(chart, "get_chart_provider", _fake_get_chart_provider)

    result = asyncio.run(
        chart.get_chart(
            "AAPL",
            market="NASDAQ",
            interval="1m",
            range="1d",
            period="1d",
            start=None,
            end=None,
            normalized=True,
            limit=None,
            cursor=None,
        )
    )
    assert result["symbol"] == "AAPL"
    assert result["interval"] == "1m"
    assert result["count"] == 1
    assert result["data"][0]["t"] == 1771927200000
    assert result["data"][0]["c"] == 11.0
    assert calls["kwargs"]["market_hint"] == "NASDAQ"


def test_chart_route_normalized_omitted_market_uses_autodetect(monkeypatch) -> None:
    calls: dict[str, object] = {}

    class _FakeProvider:
        async def get_ohlcv(self, *args, **kwargs):  # noqa: ANN002, ANN003
            calls["kwargs"] = kwargs
            return []

    async def _fake_get_chart_provider():
        return _FakeProvider()

    monkeypatch.setattr(chart, "get_chart_provider", _fake_get_chart_provider)

    result = asyncio.run(
        chart.get_chart(
            "AAPL",
            market=None,
            interval="1d",
            range="1mo",
            period="1mo",
            start=None,
            end=None,
            normalized=True,
            limit=None,
            cursor=None,
        )
    )
    assert result["symbol"] == "AAPL"
    assert result["count"] == 0
    assert result["market_hint"] == ""
    assert calls["kwargs"]["market_hint"] is None
