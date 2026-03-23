from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.alerts.service import AlertEvaluatorService
from backend.api.routes import chart
from backend.models import AlertORM, AlertStatus
from backend.providers.chart_data import OHLCVBar
from backend.services.footprint_aggregator import FootprintAggregator


BASE_TS = 1_700_000_040

FIXTURE_TICK_DATA_100 = [
    {
        "ts": BASE_TS + (index // 50) * 60 + (index % 50),
        "price": 100.0 + (index // 25) * 0.75 + (index % 5) * 0.1,
        "size": float(1 + (index % 4)),
        "side": "buy" if index % 3 else "sell",
    }
    for index in range(100)
]

FIXTURE_TICK_DATA_BALANCED = [
    {"ts": BASE_TS, "price": 100.12, "size": 10.0, "side": "buy"},
    {"ts": BASE_TS + 1, "price": 100.12, "size": 10.0, "side": "sell"},
    {"ts": BASE_TS + 2, "price": 100.38, "size": 5.0, "side": "buy"},
    {"ts": BASE_TS + 3, "price": 100.38, "size": 5.0, "side": "sell"},
]

FIXTURE_TICK_DATA_BUY_HEAVY = [
    {"ts": BASE_TS, "price": 101.0, "size": 12.0, "side": "buy"},
    {"ts": BASE_TS + 1, "price": 101.0, "size": 8.0, "side": "buy"},
    {"ts": BASE_TS + 2, "price": 101.5, "size": 15.0, "side": "buy"},
    {"ts": BASE_TS + 3, "price": 101.5, "size": 7.0, "side": "sell"},
    {"ts": BASE_TS + 4, "price": 101.5, "size": 6.0, "side": "buy"},
]


def _build_alert(symbol: str, drawing: dict[str, object]) -> AlertORM:
    return AlertORM(
        user_id=str(uuid4()),
        symbol=symbol,
        condition_type="drawing_cross",
        parameters={"drawing": drawing},
        status=AlertStatus.ACTIVE.value,
        cooldown_seconds=0,
    )


def test_footprint_aggregation_basic() -> None:
    aggregator = FootprintAggregator()
    candles = aggregator.aggregate(FIXTURE_TICK_DATA_100, "1m", 0.5)

    assert len(candles) == 2
    assert candles[0].timestamp == BASE_TS
    assert candles[1].timestamp == BASE_TS + 60
    assert candles[0].open == pytest.approx(FIXTURE_TICK_DATA_100[0]["price"], abs=1e-9)
    assert candles[0].close == pytest.approx(FIXTURE_TICK_DATA_100[49]["price"], abs=1e-9)
    assert candles[0].total_bid_volume + candles[0].total_ask_volume == pytest.approx(
        sum(float(row["size"]) for row in FIXTURE_TICK_DATA_100[:50]),
        abs=1e-9,
    )


def test_footprint_level_volumes() -> None:
    aggregator = FootprintAggregator()
    candles = aggregator.aggregate(FIXTURE_TICK_DATA_BALANCED, "1m", 0.25)

    assert len(candles) == 1
    candle = candles[0]
    assert candle.total_bid_volume == pytest.approx(15.0, abs=1e-9)
    assert candle.total_ask_volume == pytest.approx(15.0, abs=1e-9)
    level_100 = candle.levels[100.0]
    level_100_5 = candle.levels[100.5]
    assert level_100.bid_volume == pytest.approx(10.0, abs=1e-9)
    assert level_100.ask_volume == pytest.approx(10.0, abs=1e-9)
    assert level_100.delta == pytest.approx(0.0, abs=1e-9)
    assert level_100_5.bid_volume == pytest.approx(5.0, abs=1e-9)
    assert level_100_5.ask_volume == pytest.approx(5.0, abs=1e-9)


def test_footprint_delta_calculation() -> None:
    aggregator = FootprintAggregator()
    candles = aggregator.aggregate(FIXTURE_TICK_DATA_BUY_HEAVY, "1m", 0.5)

    assert len(candles) == 1
    candle = candles[0]
    assert candle.delta == pytest.approx(candle.total_ask_volume - candle.total_bid_volume, abs=1e-9)
    assert candle.delta > 0


def test_footprint_poc() -> None:
    aggregator = FootprintAggregator()
    ticks = [
        {"ts": BASE_TS, "price": 100.05, "size": 8.0, "side": "sell"},
        {"ts": BASE_TS + 1, "price": 100.05, "size": 8.0, "side": "sell"},
        {"ts": BASE_TS + 2, "price": 100.55, "size": 20.0, "side": "buy"},
        {"ts": BASE_TS + 3, "price": 100.55, "size": 20.0, "side": "buy"},
    ]
    candles = aggregator.aggregate(ticks, "1m", 0.5)

    assert len(candles) == 1
    levels = candles[0].levels
    poc = max(levels.values(), key=lambda level: level.bid_volume + level.ask_volume)
    assert poc.price == pytest.approx(100.5, abs=1e-9)
    assert poc.ask_volume == pytest.approx(40.0, abs=1e-9)


def test_footprint_price_granularity() -> None:
    aggregator = FootprintAggregator()
    ticks = [
        {"ts": BASE_TS, "price": 101.11, "size": 5.0, "side": "buy"},
        {"ts": BASE_TS + 1, "price": 101.36, "size": 5.0, "side": "sell"},
    ]
    candles = aggregator.aggregate(ticks, "1m", 0.25)

    assert len(candles) == 1
    assert sorted(candles[0].levels) == [101.0, 101.25]


def test_footprint_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeProvider:
        async def get_ohlcv(self, *args, **kwargs):  # noqa: ANN002, ANN003
            return [
                OHLCVBar(
                    timestamp=datetime(2026, 2, 24, 10, 0, tzinfo=timezone.utc),
                    open=100.0,
                    high=101.0,
                    low=99.5,
                    close=100.5,
                    volume=120.0,
                    symbol="AAPL",
                    market="US",
                ),
                OHLCVBar(
                    timestamp=datetime(2026, 2, 24, 10, 5, tzinfo=timezone.utc),
                    open=100.5,
                    high=102.0,
                    low=100.0,
                    close=101.5,
                    volume=80.0,
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

    payload = asyncio.run(chart.get_footprint("AAPL", timeframe="5m", bars=2, market="NASDAQ", price_granularity=0.5))
    assert payload["symbol"] == "AAPL"
    assert payload["timeframe"] == "5m"
    assert payload["bars"] == 2
    assert len(payload["candles"]) == 2
    assert payload["meta"]["cache_hit"] is False
    assert payload["meta"]["bars_count"] == 2
    assert payload["meta"]["candles_count"] == 2
    assert payload["candles"][0]["levels"]
    assert payload["meta"]["total_ask_volume"] >= 0
    assert payload["meta"]["total_bid_volume"] >= 0


def test_drawing_alert_horizontal() -> None:
    service = AlertEvaluatorService()
    symbol = f"NSE:ALERT-{uuid4().hex[:6]}".upper()
    service._price_cache[symbol].extend([99.0, 101.0])
    alert = _build_alert(
        symbol,
        {
            "toolType": "hline",
            "anchors": [{"time": BASE_TS, "price": 100.0}],
            "alert": {"condition": "cross_above"},
        },
    )

    ok, value = service._evaluate(alert, {"symbol": symbol, "ltp": 101.5, "timestamp": BASE_TS + 1})
    assert ok is True
    assert value == pytest.approx(100.0, abs=1e-9)


def test_drawing_alert_trendline() -> None:
    service = AlertEvaluatorService()
    symbol = f"NSE:ALERT-{uuid4().hex[:6]}".upper()
    service._price_cache[symbol].extend([104.0, 106.0])
    alert = _build_alert(
        symbol,
        {
            "tool": {"type": "trendline"},
            "anchors": [
                {"time": BASE_TS, "price": 100.0},
                {"time": BASE_TS + 100, "price": 110.0},
            ],
            "alert": {"condition": "cross_above"},
        },
    )

    ok, value = service._evaluate(alert, {"symbol": symbol, "ltp": 106.0, "timestamp": BASE_TS + 50})
    assert ok is True
    assert value == pytest.approx(105.0, abs=1e-9)
