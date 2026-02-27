import asyncio

import pandas as pd

from backend.api.routes import screener
from backend.routers import charts


class _DummyChartService:
    async def get_chart_data(self, symbol: str, timeframe: str, market: str, extended: bool = False, date_from=None, date_to=None):
        return [
            {"open": 100, "close": 101, "volume": 10},
            {"open": 101, "close": 102, "volume": 15},
            {"open": 102, "close": 100, "volume": 20},
            {"open": 100, "close": 99, "volume": 5},
        ]


def test_volume_profile_endpoint_payload_shape() -> None:
    payload = asyncio.run(
        charts.get_volume_profile(
            "AAPL",
            period="5d",
            bins=10,
            market="NASDAQ",
            service=_DummyChartService(),
        )
    )
    assert payload["symbol"] == "AAPL"
    assert isinstance(payload["bins"], list)
    assert len(payload["bins"]) == 10
    assert "poc_price" in payload
    assert "value_area_high" in payload
    assert "value_area_low" in payload


def test_multimarket_scan_filters_and_sorts(monkeypatch) -> None:
    async def _fake_hydrate(tickers, warnings, refresh_cap=30):
        df = pd.DataFrame(
            [
                {"ticker": "INFY", "market_cap": 1000, "pe": 20, "sector": "Technology"},
                {"ticker": "ITC", "market_cap": 500, "pe": 30, "sector": "Consumer"},
            ]
        )
        return df, 0

    async def _fake_snapshot(symbol: str):
        return {
            "ticker": symbol,
            "exchange": "NASDAQ",
            "market_cap": 2000 if symbol == "AAPL" else 1500,
            "pe": 18,
            "sector": "Technology",
        }

    monkeypatch.setattr(screener, "_hydrate_missing_screener_rows", _fake_hydrate)
    monkeypatch.setattr(screener, "fetch_stock_snapshot_coalesced", _fake_snapshot)

    req = screener.ScreenerScanRequest(
        markets=["NSE", "NASDAQ"],
        filters=[screener.ScreenerScanFilter(field="market_cap", op="gte", value=900)],
        sort=screener.ScreenerScanSort(field="market_cap", order="desc"),
        limit=5,
    )
    payload = asyncio.run(screener.run_multimarket_scan(req))
    assert payload["count"] >= 1
    assert payload["rows"][0]["market_cap"] >= payload["rows"][-1]["market_cap"]
