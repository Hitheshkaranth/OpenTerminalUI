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


def test_chart_template_defaults_and_crud() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "phase2-templates@example.com")

    listed_before = client.get("/api/chart-templates", headers=headers)
    assert listed_before.status_code == 200
    ids_before = {str(row.get("id")) for row in listed_before.json().get("items", [])}
    assert "default-day-trading" in ids_before
    assert "default-swing" in ids_before
    assert "default-scalping" in ids_before

    payload = {
        "name": "My Linked Layout",
        "layout_config": {
            "panels": [{"ticker": "AAPL", "timeframe": "1D"}, {"ticker": "MSFT", "timeframe": "1h"}],
            "link_groups": {"slot-1": "A", "slot-2": "A"},
        },
    }
    created = client.post("/api/chart-templates", headers=headers, json=payload)
    assert created.status_code == 200
    template_id = str(created.json()["id"])

    listed_after_create = client.get("/api/chart-templates", headers=headers)
    assert listed_after_create.status_code == 200
    rows = listed_after_create.json().get("items", [])
    created_row = next((row for row in rows if str(row.get("id")) == template_id), None)
    assert created_row is not None
    assert created_row["name"] == "My Linked Layout"
    assert created_row["layout_config"] == payload["layout_config"]

    deleted = client.delete(f"/api/chart-templates/{template_id}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["id"] == template_id

    listed_after_delete = client.get("/api/chart-templates", headers=headers)
    assert listed_after_delete.status_code == 200
    ids_after = {str(row.get("id")) for row in listed_after_delete.json().get("items", [])}
    assert template_id not in ids_after
    assert "default-day-trading" in ids_after


def test_chart_drawings_filter_update_delete_flow() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "phase2-drawings@example.com")
    symbol = "AAPL"

    first = client.post(
        f"/api/chart-drawings/{symbol}",
        headers=headers,
        json={
            "tool_type": "hline",
            "coordinates": {"price": 200.5, "timeframe": "1D", "workspace_id": "slot-A"},
            "style": {"color": "#00ff99", "lineWidth": 2},
        },
    )
    assert first.status_code == 200
    first_id = str(first.json()["id"])

    second = client.post(
        f"/api/chart-drawings/{symbol}",
        headers=headers,
        json={
            "tool_type": "trendline",
            "coordinates": {"p1": {"time": 1, "price": 10}, "p2": {"time": 2, "price": 11}, "timeframe": "5m", "workspace_id": "slot-B"},
            "style": {"color": "#ffaa00", "lineWidth": 1},
        },
    )
    assert second.status_code == 200
    second_id = str(second.json()["id"])

    filtered = client.get(f"/api/chart-drawings/{symbol}?timeframe=1D&workspace_id=slot-A", headers=headers)
    assert filtered.status_code == 200
    filtered_ids = {str(row["id"]) for row in filtered.json().get("items", [])}
    assert first_id in filtered_ids
    assert second_id not in filtered_ids

    update = client.put(
        f"/api/chart-drawings/{symbol}/{first_id}",
        headers=headers,
        json={"style": {"color": "#ff0044", "lineWidth": 3}},
    )
    assert update.status_code == 200
    assert str(update.json()["id"]) == first_id

    listed = client.get(f"/api/chart-drawings/{symbol}", headers=headers)
    assert listed.status_code == 200
    updated_row = next(row for row in listed.json().get("items", []) if str(row.get("id")) == first_id)
    assert updated_row["style"] == {"color": "#ff0044", "lineWidth": 3}

    deleted = client.delete(f"/api/chart-drawings/{symbol}/{second_id}", headers=headers)
    assert deleted.status_code == 200
    assert str(deleted.json()["id"]) == second_id

    listed_after_delete = client.get(f"/api/chart-drawings/{symbol}", headers=headers)
    assert listed_after_delete.status_code == 200
    remaining_ids = {str(row["id"]) for row in listed_after_delete.json().get("items", [])}
    assert second_id not in remaining_ids


def test_chart_drawings_preserve_layer_and_style_metadata() -> None:
    init_db()
    client = TestClient(app)
    headers = _auth_headers(client, "phase2-drawings-order@example.com")
    symbol = "MSFT"

    created = client.post(
        f"/api/chart-drawings/{symbol}",
        headers=headers,
        json={
            "tool_type": "rectangle",
            "coordinates": {
                "timeframe": "15m",
                "workspace_id": "slot-layers",
                "layer_order": 3,
                "anchors": [
                    {"time": 10, "price": 110},
                    {"time": 20, "price": 100},
                ],
            },
            "style": {
                "color": "#55aa55",
                "lineWidth": 2,
                "lineStyle": "dashed",
                "fillColor": "#55aa55",
                "fillOpacity": 28,
            },
        },
    )
    assert created.status_code == 200
    drawing_id = str(created.json()["id"])

    listed = client.get(f"/api/chart-drawings/{symbol}?timeframe=15m&workspace_id=slot-layers", headers=headers)
    assert listed.status_code == 200
    row = next(item for item in listed.json().get("items", []) if str(item.get("id")) == drawing_id)
    assert row["coordinates"]["layer_order"] == 3
    assert row["style"] == {
        "color": "#55aa55",
        "lineWidth": 2,
        "lineStyle": "dashed",
        "fillColor": "#55aa55",
        "fillOpacity": 28,
    }
