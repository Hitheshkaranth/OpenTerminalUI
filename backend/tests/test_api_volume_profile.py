from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from backend.api.routes import chart
from backend.providers.chart_data import OHLCVBar


def test_volume_profile_route_returns_expected_shape_and_metrics(monkeypatch) -> None:
    class _FakeProvider:
        async def get_ohlcv(self, *args, **kwargs):  # noqa: ANN002, ANN003
            return [
                OHLCVBar(
                    timestamp=datetime(2026, 2, 24, 10, 0, tzinfo=timezone.utc),
                    open=100.0,
                    high=102.0,
                    low=100.0,
                    close=102.0,
                    volume=100.0,
                    symbol="AAPL",
                    market="US",
                ),
                OHLCVBar(
                    timestamp=datetime(2026, 2, 24, 10, 1, tzinfo=timezone.utc),
                    open=102.0,
                    high=103.0,
                    low=101.0,
                    close=101.0,
                    volume=50.0,
                    symbol="AAPL",
                    market="US",
                ),
            ]

    async def _fake_get_chart_provider():
        return _FakeProvider()

    async def _fake_cache_get(key: str):  # noqa: ARG001
        return None

    async def _fake_cache_set(key: str, value, ttl: int):  # noqa: ANN001, ARG001
        return None

    monkeypatch.setattr(chart, "get_chart_provider", _fake_get_chart_provider)
    monkeypatch.setattr(chart.cache_instance, "get", _fake_cache_get)
    monkeypatch.setattr(chart.cache_instance, "set", _fake_cache_set)

    payload = asyncio.run(chart.get_volume_profile("AAPL", period="5d", bins=10, market="NASDAQ"))
    assert payload["symbol"] == "AAPL"
    assert payload["period"] == "5d"
    assert len(payload["bins"]) == 10
    assert payload["poc_price"] is not None
    assert payload["value_area_high"] is not None
    assert payload["value_area_low"] is not None
    assert payload["meta"]["cache_hit"] is False
    assert payload["meta"]["bars_count"] == 2
    assert payload["meta"]["total_volume"] == pytest.approx(150.0, abs=1e-6)


def test_volume_profile_route_uses_cached_payload(monkeypatch) -> None:
    cached_payload = {
        "symbol": "AAPL",
        "period": "5d",
        "bins": [{"price_low": 1.0, "price_high": 2.0, "volume": 3.0, "buy_volume": 2.0, "sell_volume": 1.0}],
        "poc_price": 1.5,
        "value_area_high": 2.0,
        "value_area_low": 1.0,
        "meta": {"cache_hit": False},
    }

    async def _fake_cache_get(key: str):  # noqa: ARG001
        return cached_payload

    async def _fake_get_chart_provider():
        raise AssertionError("provider should not be called on cache hit")

    monkeypatch.setattr(chart.cache_instance, "get", _fake_cache_get)
    monkeypatch.setattr(chart, "get_chart_provider", _fake_get_chart_provider)

    payload = asyncio.run(chart.get_volume_profile("AAPL", period="5d", bins=10, market="NASDAQ"))
    assert payload["poc_price"] == 1.5
    assert payload["meta"]["cache_hit"] is True


def test_volume_profile_route_rejects_invalid_params() -> None:
    with pytest.raises(HTTPException) as exc_bins:
        asyncio.run(chart.get_volume_profile("AAPL", period="5d", bins=2, market="NASDAQ"))
    assert exc_bins.value.status_code == 400
    assert "bins must be between 10 and 200" in str(exc_bins.value.detail)

    with pytest.raises(HTTPException) as exc_period:
        asyncio.run(chart.get_volume_profile("AAPL", period="bad-period", bins=10, market="NASDAQ"))
    assert exc_period.value.status_code == 400
    assert "period must match" in str(exc_period.value.detail)
