from __future__ import annotations

import pandas as pd
from fastapi.testclient import TestClient

from backend.api.routes import peers, screener
from backend.main import app


def test_peers_route_returns_payload_without_500(monkeypatch) -> None:
    class _FakeFmp:
        async def get_peers(self, symbol: str):
            return ["AAA.NS", "BBB.NS"]

    class _FakeUnified:
        fmp = _FakeFmp()

    async def _fake_get_unified_fetcher():
        return _FakeUnified()

    async def _fake_snapshot(symbol: str):
        return {"ticker": symbol, "pe": 20.0, "market_cap": 1000.0, "beta": 1.0}

    monkeypatch.setattr(peers, "get_unified_fetcher", _fake_get_unified_fetcher)
    monkeypatch.setattr(peers, "fetch_stock_snapshot_coalesced", _fake_snapshot)

    client = TestClient(app)
    response = client.get("/api/peers/AAA")
    assert response.status_code == 200
    body = response.json()
    assert body["ticker"] == "AAA"
    assert "metrics" in body
    assert isinstance(body["metrics"], list)


def test_screener_type_mismatch_rule_does_not_500(monkeypatch) -> None:
    monkeypatch.setattr(
        screener,
        "load_screener_df",
        lambda tickers: pd.DataFrame(
            [
                {"ticker": "AAA", "company_name": "AAA Corp", "roe_pct": 10.0, "pe": 15.0},
                {"ticker": "BBB", "company_name": "BBB Corp", "roe_pct": 8.0, "pe": 12.0},
            ]
        ),
    )
    monkeypatch.setattr(screener, "_load_universe", lambda universe: ["AAA", "BBB"])

    client = TestClient(app)
    payload = {
        "rules": [{"field": "company_name", "op": ">", "value": 1}],
        "sort_by": "roe_pct",
        "sort_order": "desc",
        "limit": 5,
        "universe": "nse_eq",
    }
    response = client.post("/api/screener/run", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert "rows" in body
    assert isinstance(body["rows"], list)
