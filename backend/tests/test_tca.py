import os
os.environ["AUTH_MIDDLEWARE_ENABLED"] = "0"

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_tca_endpoint():
    # 1. Test default window
    r1 = client.get("/api/paper/tca")
    assert r1.status_code == 200
    data1 = r1.json()
    assert "per_trade_stats" in data1
    assert "aggregates" in data1
    assert len(data1["per_trade_stats"]) == 10
    assert data1["aggregates"]["total_fees"] == 15.0 # 10 * 1.5

    # 2. Test different window deterministic evaluation
    r2 = client.get("/api/paper/tca?window=7d")
    assert r2.status_code == 200
    data2 = r2.json()

    # The deterministic hash seed should make them differently distributed
    assert data1["per_trade_stats"][0]["trade_id"] != data2["per_trade_stats"][0]["trade_id"]

    # 3. Test repeatability
    r3 = client.get("/api/paper/tca?window=7d")
    data3 = r3.json()
    assert data2["aggregates"]["total_slippage"] == data3["aggregates"]["total_slippage"]
