from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import depth as depth_routes


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(depth_routes.router, prefix="/api")
    return app


def test_dom_depth_endpoint_returns_sorted_l2_book_with_metrics() -> None:
    client = TestClient(_build_app())

    response = client.get("/api/depth/RELIANCE", params={"market": "IN", "levels": 20})
    assert response.status_code == 200

    payload = response.json()
    bids = payload["bids"]
    asks = payload["asks"]

    assert len(bids) == 20
    assert len(asks) == 20
    assert bids == sorted(bids, key=lambda row: row["price"], reverse=True)
    assert asks == sorted(asks, key=lambda row: row["price"])

    bid_cumulative = [row["cumulative_qty"] for row in bids]
    ask_cumulative = [row["cumulative_qty"] for row in asks]
    assert bid_cumulative == sorted(bid_cumulative)
    assert ask_cumulative == sorted(ask_cumulative)

    best_bid = bids[0]["price"]
    best_ask = asks[0]["price"]
    assert payload["spread"] == pytest.approx(best_ask - best_bid)
    assert -1.0 <= payload["imbalance"] <= 1.0
    assert payload["total_bid_qty"] == payload["total_bid_quantity"]
    assert payload["total_ask_qty"] == payload["total_ask_quantity"]
    assert payload["last_price"] > 0
    assert payload["last_qty"] > 0

