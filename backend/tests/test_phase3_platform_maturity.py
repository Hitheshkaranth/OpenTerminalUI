from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "StrongPass123!"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_tax_lot_endpoints_fifo_roundtrip() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "phase3-taxlots@example.com")

    created = client.post(
        "/api/portfolio/tax-lots",
        headers=headers,
        json={"ticker": "INFY", "quantity": 10, "buy_price": 1000, "buy_date": "2024-01-10"},
    )
    assert created.status_code == 200

    listed = client.get("/api/portfolio/tax-lots", headers=headers)
    assert listed.status_code == 200
    body = listed.json()
    assert "lots" in body
    assert any(str(x.get("ticker")) == "INFY" for x in body["lots"])

    realized = client.post(
        "/api/portfolio/tax-lots/realize",
        headers=headers,
        json={
            "ticker": "INFY",
            "quantity": 4,
            "sell_price": 1200,
            "sell_date": "2025-02-10",
            "method": "FIFO",
        },
    )
    assert realized.status_code == 200
    out = realized.json()
    assert out["symbol"] == "INFY"
    assert out["method"] == "FIFO"
    assert out["realized_gain_total"] > 0


def test_portfolio_analytics_endpoints_smoke() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "phase3-analytics@example.com")

    r1 = client.get("/api/portfolio/analytics/risk-metrics", headers=headers)
    assert r1.status_code == 200
    assert "sharpe_ratio" in r1.json()

    r2 = client.get("/api/portfolio/analytics/correlation", headers=headers)
    assert r2.status_code == 200
    assert "matrix" in r2.json()

    r3 = client.get("/api/portfolio/analytics/dividends", headers=headers)
    assert r3.status_code == 200
    assert "annual_income_projection" in r3.json()


def test_export_csv_endpoint_smoke() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "phase3-export@example.com")
    res = client.get("/api/export/watchlist?format=csv", headers=headers)
    assert res.status_code == 200
    assert "text/csv" in str(res.headers.get("content-type", ""))


def test_plugins_routes_discover_examples() -> None:
    client = TestClient(app)
    headers = _auth_headers(client, "phase3-plugins@example.com")
    res = client.get("/api/plugins", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert "items" in body
    assert any("rsi_divergence_scanner" in str(x.get("name")) for x in body["items"])
