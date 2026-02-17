from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app
from backend.shared.db import init_db


def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "StrongPass123!"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_alert_crud_and_history_route_smoke() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "phase2-alerts@example.com")

    created = client.post(
        "/api/alerts",
        headers=headers,
        json={
            "symbol": "NSE:RELIANCE",
            "condition_type": "price_above",
            "parameters": {"threshold": 2500},
            "cooldown_seconds": 60,
        },
    )
    assert created.status_code == 200
    alert_id = created.json()["alert"]["id"]

    listed = client.get("/api/alerts", headers=headers)
    assert listed.status_code == 200
    assert any(str(row["id"]) == str(alert_id) for row in listed.json()["alerts"])

    updated = client.patch(f"/api/alerts/{alert_id}", headers=headers, json={"status": "paused"})
    assert updated.status_code == 200

    history = client.get("/api/alerts/history", headers=headers)
    assert history.status_code == 200
    assert "history" in history.json()

    deleted = client.delete(f"/api/alerts/{alert_id}", headers=headers)
    assert deleted.status_code == 200


def test_paper_trading_endpoints_smoke() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "phase2-paper@example.com")

    created = client.post("/api/paper/portfolios", headers=headers, json={"name": "Demo", "initial_capital": 100000})
    assert created.status_code == 200
    portfolio_id = created.json()["id"]

    listed = client.get("/api/paper/portfolios", headers=headers)
    assert listed.status_code == 200
    assert any(str(row["id"]) == str(portfolio_id) for row in listed.json()["items"])

    order = client.post(
        "/api/paper/orders",
        headers=headers,
        json={
            "portfolio_id": portfolio_id,
            "symbol": "NSE:RELIANCE",
            "side": "buy",
            "order_type": "limit",
            "quantity": 2,
            "limit_price": 1000,
        },
    )
    assert order.status_code == 200

    positions = client.get(f"/api/paper/portfolios/{portfolio_id}/positions", headers=headers)
    assert positions.status_code == 200
    assert "items" in positions.json()

    orders = client.get(f"/api/paper/portfolios/{portfolio_id}/orders", headers=headers)
    assert orders.status_code == 200
    assert len(orders.json()["items"]) >= 1

    perf = client.get(f"/api/paper/portfolios/{portfolio_id}/performance", headers=headers)
    assert perf.status_code == 200
    assert "cumulative_return" in perf.json()


def test_chart_drawings_crud_smoke() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "phase2-draw@example.com")
    symbol = "NSE:RELIANCE"

    created = client.post(
        f"/api/chart-drawings/{symbol}",
        headers=headers,
        json={"tool_type": "trendline", "coordinates": {"x1": 1, "x2": 2}, "style": {"color": "#00ff00"}},
    )
    assert created.status_code == 200
    drawing_id = created.json()["id"]

    listed = client.get(f"/api/chart-drawings/{symbol}", headers=headers)
    assert listed.status_code == 200
    assert any(str(row["id"]) == str(drawing_id) for row in listed.json()["items"])

    updated = client.put(
        f"/api/chart-drawings/{symbol}/{drawing_id}",
        headers=headers,
        json={"style": {"color": "#ff0000"}},
    )
    assert updated.status_code == 200

    deleted = client.delete(f"/api/chart-drawings/{symbol}/{drawing_id}", headers=headers)
    assert deleted.status_code == 200
