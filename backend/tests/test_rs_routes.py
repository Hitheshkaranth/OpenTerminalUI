from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import rs as rs_routes


def _series(daily_growth: float, days: int = 300) -> list[tuple[str, float, float]]:
    start = date(2025, 1, 1)
    out = []
    price = 100.0
    for i in range(days):
        price *= 1.0 + daily_growth
        out.append(((start + timedelta(days=i)).isoformat(), price, price))
    return out


@pytest.fixture()
def client(monkeypatch):
    growth = {"RELIANCE": -0.002, "TCS": 0.001, "INFY": 0.003, "^NSEI": 0.0005}

    async def _loader(symbol: str):
        return _series(growth[symbol]) if symbol in growth else []

    monkeypatch.setattr(rs_routes, "_loader", _loader)
    monkeypatch.setattr(rs_routes, "_cache", {})
    app = FastAPI()
    app.include_router(rs_routes.router, prefix="/api")
    return TestClient(app)


def test_rankings_are_computed_from_price_history(client) -> None:
    rows = client.get("/api/rs/rankings", params={"universe": "Nifty 50"}).json()

    assert [r["symbol"] for r in rows] == ["INFY", "TCS", "RELIANCE"]
    reliance = rows[-1]
    # A falling stock must rank at the bottom, not RS 92.
    assert reliance["rs_score"] == 1
    assert reliance["return_3m_pct"] < 0
    assert rows[0]["rs_score"] == 99


def test_unknown_universe_and_missing_data_return_empty(client) -> None:
    assert client.get("/api/rs/rankings", params={"universe": "Mars 100"}).json() == []
    assert client.get("/api/rs/chart/UNKNOWN").json() == []


def test_rs_chart_rebased_to_100(client) -> None:
    rows = client.get("/api/rs/chart/INFY").json()
    assert rows[0]["rs_line"] == 100.0
    assert rows[-1]["rs_line"] > 100.0
