from __future__ import annotations

import asyncio

from backend.api.routes import stocks


def test_get_stock_maps_country_exchange_indices(monkeypatch) -> None:
    async def _fake_fetch_snapshot(_ticker: str):
        return {
            "company_name": "Reliance Industries",
            "sector": "Energy",
            "industry": "Oil & Gas",
            "current_price": 2900.0,
            "change_pct": 1.2,
            "country_code": "IN",
            "exchange": "NSE",
            "indices": ["NIFTY 50"],
        }

    monkeypatch.setattr(stocks, "fetch_stock_snapshot_coalesced", _fake_fetch_snapshot)
    result = asyncio.run(stocks.get_stock("RELIANCE"))
    assert result.country_code == "IN"
    assert result.exchange == "NSE"
    assert result.indices == ["NIFTY 50"]
