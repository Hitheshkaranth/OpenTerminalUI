from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import screener


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(screener.router, prefix="/api")
    return TestClient(app)


def test_scan_rejects_invalid_filter_field() -> None:
    client = _build_client()
    response = client.post(
        "/api/screener/scan",
        json={
            "markets": ["NSE", "NASDAQ"],
            "filters": [{"field": "unsupported_field", "op": "gte", "value": 10}],
            "sort": {"field": "market_cap", "order": "desc"},
            "limit": 10,
        },
    )
    assert response.status_code == 422


def test_scan_rejects_invalid_filter_operator() -> None:
    client = _build_client()
    response = client.post(
        "/api/screener/scan",
        json={
            "markets": ["NSE"],
            "filters": [{"field": "market_cap", "op": "between", "value": 10}],
            "sort": {"field": "market_cap", "order": "desc"},
            "limit": 10,
        },
    )
    assert response.status_code == 422


def test_scan_merges_markets_applies_filters_and_sorts(monkeypatch) -> None:
    async def _fake_nse_fetch(self, _warnings):
        return [
            {"ticker": "INFY", "symbol": "INFY", "exchange": "NSE", "market": "NSE", "country": "IN", "market_cap": 1200, "sector": "Technology"},
            {"ticker": "ITC", "symbol": "ITC", "exchange": "NSE", "market": "NSE", "country": "IN", "market_cap": 800, "sector": "Consumer"},
        ]

    async def _fake_fmp_fetch(self, _markets):
        return [
            {"ticker": "AAPL", "symbol": "AAPL", "exchange": "NASDAQ", "market": "NASDAQ", "country": "US", "market_cap": 2500, "sector": "Technology"},
            {"ticker": "MSFT", "symbol": "MSFT", "exchange": "NASDAQ", "market": "NASDAQ", "country": "US", "market_cap": 2000, "sector": "Technology"},
        ]

    monkeypatch.setattr(screener.NSEScreenerAdapter, "fetch", _fake_nse_fetch)
    monkeypatch.setattr(screener.FMPScreenerAdapter, "fetch", _fake_fmp_fetch)

    client = _build_client()
    response = client.post(
        "/api/screener/scan",
        json={
            "markets": ["NSE", "NASDAQ"],
            "filters": [
                {"field": "market_cap", "op": "gte", "value": 1000},
                {"field": "sector", "op": "contains", "value": "tech"},
                {"field": "exchange", "op": "in", "value": ["NSE", "NASDAQ"]},
            ],
            "sort": {"field": "market_cap", "order": "desc"},
            "limit": 2,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert [row["symbol"] for row in payload["rows"]] == ["AAPL", "MSFT"]
    assert payload["rows"][0]["market_cap"] >= payload["rows"][1]["market_cap"]


def test_scan_formula_blocks_code_execution_primitives() -> None:
    row = {"symbol": "AAPL", "pe_ratio": 20}
    assert screener._passes_formula(row, "pe_ratio > 10 AND symbol == 'AAPL'") is True
    assert screener._passes_formula(row, "__import__('os').system('echo x')") is False
    assert screener._passes_formula(row, "symbol.__class__ == 'str'") is False
    assert screener._passes_formula(row, "len(symbol) > 1") is False


def test_scan_formula_supports_list_membership_without_calls() -> None:
    row = {"exchange": "NASDAQ", "market_cap": 2500}
    assert screener._passes_formula(row, "exchange IN ['NSE', 'NASDAQ'] AND market_cap >= 1000") is True
