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


def test_alert_create_returns_channel_status() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "alert-channels@example.com")

    created = client.post(
        "/api/alerts",
        headers=headers,
        json={
            "symbol": "NSE:RELIANCE",
            "condition_type": "price_above",
            "parameters": {"threshold": 2500, "webhook_url": "https://example.com/hook"},
            "channels": ["in_app", "webhook"],
        },
    )
    assert created.status_code == 200
    payload = created.json()["alert"]
    assert "channels" in payload
    assert "channel_status" in payload
    assert payload["channel_status"]["webhook"]["enabled"] is True


def test_alert_channel_status_endpoint_exists() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "alert-channel-status@example.com")
    resp = client.get("/api/alerts/channels/status", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "channels" in body
    assert "in_app" in body["channels"]
