from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from backend.api.routes import stocks


def _build_delivery_chart(days: int = 40) -> dict:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    timestamps: list[int] = []
    opens: list[float] = []
    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []
    volumes: list[int] = []
    for i in range(days):
        base = 100 + i * 0.5
        ts = int((start + timedelta(days=i)).timestamp())
        timestamps.append(ts)
        opens.append(base)
        highs.append(base + 2)
        lows.append(base - 1.5)
        closes.append(base + 1)
        volumes.append(1_000_000 + i * 5000)

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


def test_delivery_series_returns_points(monkeypatch) -> None:
    class _FakeYahoo:
        async def get_chart(self, symbol: str, range_str: str = "1y", interval: str = "1d"):  # noqa: ARG002
            return _build_delivery_chart()

    class _FakeFetcher:
        yahoo = _FakeYahoo()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(stocks, "get_unified_fetcher", _fake_get_unified_fetcher)
    result = asyncio.run(stocks.get_delivery_series("reliance", interval="1d", range="1y"))
    assert result.symbol == "RELIANCE"
    assert result.interval == "1d"
    assert len(result.points) == 40
    assert 5.0 <= result.points[-1].delivery_pct <= 95.0
