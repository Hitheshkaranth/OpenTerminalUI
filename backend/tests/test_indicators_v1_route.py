from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from backend.api.routes import indicators


def _chart_payload(days: int = 40) -> dict:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    ts = [int((start + timedelta(days=i)).timestamp()) for i in range(days)]
    close = [100 + i for i in range(days)]
    return {
        "chart": {
            "result": [
                {
                    "timestamp": ts,
                    "indicators": {
                        "quote": [
                            {
                                "open": close,
                                "high": [c + 1 for c in close],
                                "low": [c - 1 for c in close],
                                "close": close,
                                "volume": [1000 + i for i in range(days)],
                            }
                        ]
                    },
                }
            ]
        }
    }


def test_indicator_registry_has_expected_items() -> None:
    result = asyncio.run(indicators.get_indicator_registry())
    ids = {item.id for item in result.items}
    assert {"sma", "ema", "rsi", "macd", "bollinger", "atr", "volume"} <= ids


def test_indicator_compute_returns_points(monkeypatch) -> None:
    class _FakeFetcher:
        async def fetch_history(self, ticker: str, range_str: str = "1y", interval: str = "1d"):  # noqa: ARG002
            return _chart_payload()

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(indicators, "get_unified_fetcher", _fake_get_unified_fetcher)
    payload = indicators.IndicatorComputeRequest(symbol="RELIANCE", indicator="sma", params={"period": 5})
    result = asyncio.run(indicators.compute_indicator_series(payload))
    assert result.ticker == "RELIANCE"
    assert result.indicator == "sma"
    assert len(result.data) > 0
