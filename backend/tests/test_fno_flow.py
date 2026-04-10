from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes.fno_flow import router
from backend.fno.services.flow_service import OptionsFlowService


class StubFlowFetcher:
    async def get_expiry_dates(self, symbol: str) -> list[str]:
        return ["2026-04-30"]

    async def get_option_chain(self, symbol: str, expiry: str | None = None, strike_range: int = 24) -> dict:
        return {
            "symbol": symbol.upper(),
            "spot_price": 22500.0,
            "timestamp": "2026-04-05T10:15:00+00:00",
            "expiry_date": expiry or "2026-04-30",
            "atm_strike": 22500.0,
            "strikes": [
                {
                    "strike_price": 22400,
                    "ce": {"oi": 120000, "oi_change": 2500, "volume": 22000, "iv": 18.2, "ltp": 185.0},
                    "pe": {"oi": 98000, "oi_change": 900, "volume": 2500, "iv": 19.1, "ltp": 72.0},
                },
                {
                    "strike_price": 22500,
                    "ce": {"oi": 110000, "oi_change": 1200, "volume": 6000, "iv": 17.8, "ltp": 132.0},
                    "pe": {"oi": 145000, "oi_change": 4800, "volume": 26000, "iv": 20.6, "ltp": 165.0},
                },
                {
                    "strike_price": 22600,
                    "ce": {"oi": 76000, "oi_change": 600, "volume": 1200, "iv": 16.9, "ltp": 90.0},
                    "pe": {"oi": 160000, "oi_change": 700, "volume": 1800, "iv": 21.0, "ltp": 210.0},
                },
            ],
            "totals": {"pcr_oi": 1.24, "pcr_volume": 1.11},
        }


def create_client(monkeypatch) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    service = OptionsFlowService(fetcher=StubFlowFetcher())
    monkeypatch.setattr("backend.api.routes.fno_flow.get_options_flow_service", lambda: service)
    return TestClient(app)


def test_get_unusual_flow_returns_expected_shape(monkeypatch) -> None:
    client = create_client(monkeypatch)

    response = client.get("/api/fno/flow/unusual")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] >= 1
    assert isinstance(body["flows"], list)

    first = body["flows"][0]
    for field in ("symbol", "strike", "option_type", "volume", "heat_score", "sentiment"):
        assert field in first
    assert 0 <= first["heat_score"] <= 100
    assert first["sentiment"] in {"bullish", "bearish"}


def test_get_flow_summary_returns_aggregates(monkeypatch) -> None:
    client = create_client(monkeypatch)

    response = client.get("/api/fno/flow/summary", params={"period": "1d"})
    assert response.status_code == 200
    body = response.json()
    assert body["total_premium"] > 0
    assert body["bullish_premium"] >= 0
    assert body["bearish_premium"] >= 0
    assert isinstance(body["top_symbols"], list)
    assert isinstance(body["premium_by_hour"], list)


def test_symbol_filter_works(monkeypatch) -> None:
    client = create_client(monkeypatch)

    response = client.get("/api/fno/flow/unusual", params={"symbol": "RELIANCE"})
    assert response.status_code == 200
    body = response.json()
    assert body["count"] >= 1
    assert all(item["symbol"] == "RELIANCE" for item in body["flows"])


def test_min_premium_filter_works(monkeypatch) -> None:
    client = create_client(monkeypatch)

    response = client.get("/api/fno/flow/unusual", params={"min_premium": 450000000})
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 0
    assert body["flows"] == []
