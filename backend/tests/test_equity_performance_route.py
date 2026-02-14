from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from backend.api.routes import stocks


def _build_chart_payload(days: int = 420) -> dict:
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    timestamps: list[int] = []
    opens: list[float] = []
    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []
    volumes: list[int] = []

    price = 100.0
    for i in range(days):
        ts = int((start + timedelta(days=i)).timestamp())
        # Inject one strong up move and one strong down move in the recent window.
        if i == days - 120:
            price *= 1.2
        elif i == days - 100:
            price *= 0.85
        else:
            price += 0.4

        close = round(price, 4)
        open_ = round(close - 0.5, 4)
        high = round(close + 1.25, 4)
        low = round(close - 1.35, 4)
        timestamps.append(ts)
        opens.append(open_)
        highs.append(high)
        lows.append(low)
        closes.append(close)
        volumes.append(1_000_000 + i)

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


def test_get_company_performance_returns_expected_shape(monkeypatch) -> None:
    class _FakeYahoo:
        async def get_chart(self, symbol: str, range_str: str, interval: str):  # noqa: ARG002
            assert symbol == "RELIANCE.NS"
            return _build_chart_payload()

    class _FakeFetcher:
        yahoo = _FakeYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(stocks, "get_unified_fetcher", _fake_get_unified_fetcher)

    result = asyncio.run(stocks.get_company_performance("reliance"))
    assert result.symbol == "RELIANCE"
    assert set(result.period_changes_pct.keys()) == {"1D", "1W", "1M", "3M", "6M", "1Y"}
    assert result.period_changes_pct["1D"] is not None
    assert result.period_changes_pct["1Y"] is not None
    assert result.max_up_move_pct is not None and result.max_up_move_pct > 0
    assert result.max_down_move_pct is not None and result.max_down_move_pct < 0
    assert result.day_range.high is not None and result.day_range.low is not None
    assert result.range_52w.high is not None and result.range_52w.low is not None
    assert result.range_52w.high >= result.day_range.high


def test_get_company_performance_raises_on_missing_history(monkeypatch) -> None:
    class _FakeYahoo:
        async def get_chart(self, symbol: str, range_str: str, interval: str):  # noqa: ARG002
            return {}

    class _FakeFetcher:
        yahoo = _FakeYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(stocks, "get_unified_fetcher", _fake_get_unified_fetcher)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(stocks.get_company_performance("reliance"))

    assert exc.value.status_code == 404
