from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import insider as insider_routes


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(insider_routes.router)
    return TestClient(app)


def test_recent_returns_trades_array() -> None:
    client = _build_client()

    response = client.get("/api/insider/recent")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["trades"], list)
    assert payload["trades"]
    assert {
        "date",
        "symbol",
        "name",
        "insider_name",
        "designation",
        "type",
        "quantity",
        "price",
        "value",
        "post_holding_pct",
    } <= set(payload["trades"][0])


def test_stock_returns_trades_and_summary() -> None:
    client = _build_client()

    response = client.get("/api/insider/stock/RELIANCE", params={"days": 365})

    assert response.status_code == 200
    payload = response.json()
    assert payload["trades"]
    assert payload["summary"]["total_buys"] >= 0
    assert payload["summary"]["total_sells"] >= 0
    assert payload["summary"]["insider_count"] >= 1
    assert all(row["symbol"] == "RELIANCE" for row in payload["trades"])


def test_top_buyers_returns_ranked_list() -> None:
    client = _build_client()

    response = client.get("/api/insider/top-buyers", params={"days": 90, "limit": 5})

    assert response.status_code == 200
    buyers = response.json()["buyers"]
    assert buyers
    assert len(buyers) <= 5
    assert buyers == sorted(buyers, key=lambda item: item["total_value"], reverse=True)
    assert {"symbol", "name", "total_value", "trade_count", "avg_price", "latest_date"} <= set(buyers[0])


def test_cluster_buys_returns_stocks_with_minimum_insiders() -> None:
    client = _build_client()

    response = client.get("/api/insider/cluster-buys", params={"days": 30, "min_insiders": 3})

    assert response.status_code == 200
    clusters = response.json()["clusters"]
    assert clusters
    assert all(cluster["insider_count"] >= 3 for cluster in clusters)
    assert all(len(cluster["insiders"]) >= 3 for cluster in clusters)


def test_recent_filters_support_min_value_type_and_days() -> None:
    client = _build_client()

    response = client.get(
        "/api/insider/recent",
        params={"days": 14, "min_value": 4_000_000, "type": "buy", "limit": 100},
    )

    assert response.status_code == 200
    trades = response.json()["trades"]
    assert trades
    assert all(trade["type"] == "buy" for trade in trades)
    assert all(float(trade["value"]) >= 4_000_000 for trade in trades)
