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


def test_alert_crud_flow_is_deterministic() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "alert-crud@example.com")

    created = client.post(
        "/api/alerts",
        headers=headers,
        json={
            "symbol": "NSE:RELIANCE",
            "condition_type": "price_above",
            "parameters": {
                "threshold": 2500,
                "webhook_url": "https://example.com/hook",
                "chart_context": {
                    "version": 1,
                    "surface": "chart",
                    "source": "drawing",
                    "symbol": "NSE:RELIANCE",
                    "market": "NSE",
                    "timeframe": "1D",
                    "panelId": "slot-1",
                    "workspaceId": "slot-1",
                    "sourceLabel": "Horizontal Line",
                    "referencePrice": 2500,
                    "referenceTime": 1700000000,
                },
            },
            "channels": ["in_app", "webhook"],
            "cooldown_seconds": 120,
        },
    )
    assert created.status_code == 200
    payload = created.json()
    alert_id = payload["alert"]["id"]
    assert payload["status"] == "created"
    assert payload["alert"]["channels"] == ["in_app", "webhook"]

    listed = client.get("/api/alerts", headers=headers)
    assert listed.status_code == 200
    alerts = listed.json()["alerts"]
    match = next((item for item in alerts if item["id"] == alert_id), None)
    assert match is not None
    assert match["symbol"] == "NSE:RELIANCE"
    assert match["cooldown_seconds"] == 120
    assert match["parameters"]["chart_context"]["source"] == "drawing"

    filtered = client.get("/api/alerts", headers=headers, params={"status": "active", "symbol": "RELIANCE"})
    assert filtered.status_code == 200
    assert [item["id"] for item in filtered.json()["alerts"]] == [alert_id]

    updated = client.patch(
        f"/api/alerts/{alert_id}",
        headers=headers,
        json={"status": "paused", "cooldown_seconds": 30, "channels": ["in_app", "webhook"]},
    )
    assert updated.status_code == 200
    updated_payload = updated.json()
    assert updated_payload["status"] == "updated"
    assert updated_payload["channels"] == ["in_app", "webhook"]
    assert updated_payload["channel_status"]["webhook"]["enabled"] is True

    deleted = client.delete(f"/api/alerts/{alert_id}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json() == {"status": "deleted", "id": alert_id}

    after_delete = client.get("/api/alerts", headers=headers)
    assert after_delete.status_code == 200
    final_match = next((item for item in after_delete.json()["alerts"] if item["id"] == alert_id), None)
    assert final_match is not None
    assert final_match["status"] == "deleted"
