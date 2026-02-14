from __future__ import annotations

import asyncio

from backend.api.routes import data as data_route
from backend.core.historical_data_service import HistoricalDataService, OhlcvBar
from backend.core.symbols import normalize_symbol


class _FakeProvider:
    def get_daily_ohlcv(self, symbol, start: str, end: str):  # noqa: ANN001
        return [
            OhlcvBar(date="2026-01-01", open=100.0, high=101.0, low=99.0, close=100.5, volume=10),
            OhlcvBar(date="2026-01-02", open=101.0, high=103.0, low=100.0, close=102.0, volume=12),
        ]


def test_symbol_normalization_maps_provider_symbol() -> None:
    s = normalize_symbol("reliance", "NSE")
    assert s.canonical == "RELIANCE"
    assert s.provider_symbol == "RELIANCE.NS"


def test_historical_service_uses_provider_and_limit() -> None:
    service = HistoricalDataService(provider=_FakeProvider())
    symbol, bars = service.fetch_daily_ohlcv("reliance", market="NSE", start="2026-01-01", end="2026-01-03", limit=1)
    assert symbol.canonical == "RELIANCE"
    assert len(bars) == 1
    assert bars[0].date == "2026-01-02"


def test_ohlcv_route_returns_mocked_payload(monkeypatch) -> None:
    service = HistoricalDataService(provider=_FakeProvider())
    monkeypatch.setattr(data_route, "get_historical_data_service", lambda: service)
    result = asyncio.run(
        data_route.get_ohlcv(
            symbol="reliance",
            market="NSE",
            start="2026-01-01",
            end="2026-01-10",
            limit=2,
        )
    )
    assert result["symbol"] == "RELIANCE"
    assert len(result["bars"]) == 2
