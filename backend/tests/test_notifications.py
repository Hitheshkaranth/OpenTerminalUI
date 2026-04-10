from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app
from backend.shared.db import init_db, engine, Base

def _init_fresh_db():
    Base.metadata.drop_all(bind=engine)
    init_db()

def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "StrongPass123!"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_notification_routes_flow() -> None:
    _init_fresh_db()
    client = TestClient(app)
    headers = _auth_headers(client, "notifications@example.com")

    created_a = client.post(
        "/api/notifications",
        headers=headers,
        json={"type": "alert", "title": "Alert one", "body": "First body", "ticker": "AAPL", "priority": "high"},
    )
    created_b = client.post(
        "/api/notifications",
        headers=headers,
        json={"type": "news", "title": "News one", "body": "Second body", "ticker": "MSFT", "priority": "medium"},
    )

    assert created_a.status_code == 201
    assert created_b.status_code == 201

    notification_a = created_a.json()
    notification_b = created_b.json()

    listed = client.get("/api/notifications", headers=headers)
    assert listed.status_code == 200
    listed_payload = listed.json()
    assert [item["id"] for item in listed_payload[:2]] == [notification_b["id"], notification_a["id"]]

    filtered = client.get("/api/notifications", headers=headers, params={"type": "alert"})
    assert filtered.status_code == 200
    assert [item["id"] for item in filtered.json()] == [notification_a["id"]]

    unread_count = client.get("/api/notifications/unread-count", headers=headers)
    assert unread_count.status_code == 200
    assert unread_count.json() == {"count": 2}

    marked = client.put(f"/api/notifications/{notification_a['id']}/read", headers=headers)
    assert marked.status_code == 200
    assert marked.json()["read"] is True

    unread_after_single = client.get("/api/notifications/unread-count", headers=headers)
    assert unread_after_single.json() == {"count": 1}

    marked_all = client.put("/api/notifications/read-all", headers=headers)
    assert marked_all.status_code == 200
    assert marked_all.json() == {"updated": 1}

    unread_after_all = client.get("/api/notifications/unread-count", headers=headers)
    assert unread_after_all.json() == {"count": 0}

    deleted = client.delete(f"/api/notifications/{notification_b['id']}", headers=headers)
    assert deleted.status_code == 204

    remaining = client.get("/api/notifications", headers=headers)
    assert remaining.status_code == 200
    assert [item["id"] for item in remaining.json()] == [notification_a["id"]]
