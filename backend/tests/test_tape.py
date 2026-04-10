from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import tape as tape_routes


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(tape_routes.router, prefix="/api/tape")
    return TestClient(app)


def test_tape_recent_returns_trade_rows() -> None:
    client = _build_client()

    response = client.get("/api/tape/RELIANCE/recent")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("trades"), list)
    assert payload["trades"]
    first = payload["trades"][0]
    assert "timestamp" in first
    assert "price" in first
    assert "quantity" in first
    assert "side" in first


def test_tape_recent_side_values_are_constrained() -> None:
    client = _build_client()

    response = client.get("/api/tape/RELIANCE/recent", params={"limit": 50})

    assert response.status_code == 200
    payload = response.json()
    sides = {trade["side"] for trade in payload["trades"]}
    assert sides <= {"buy", "sell", "neutral"}


def test_tape_summary_returns_expected_fields() -> None:
    client = _build_client()

    response = client.get("/api/tape/RELIANCE/summary")

    assert response.status_code == 200
    payload = response.json()
    for key in ("total_volume", "buy_volume", "sell_volume", "buy_pct", "large_trade_count", "avg_trade_size", "trades_per_min"):
        assert key in payload


def test_tape_recent_limit_is_applied() -> None:
    client = _build_client()

    response = client.get("/api/tape/RELIANCE/recent", params={"limit": 10})

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["trades"]) <= 10
