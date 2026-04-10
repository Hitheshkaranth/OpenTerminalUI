from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.alerts.service import AlertEvaluatorService
from backend.main import app
from backend.models import AlertORM, AlertStatus, AlertTriggerORM
from backend.shared.db import SessionLocal, init_db


def _init_fresh_db():
    from backend.shared.db import engine, Base, init_db
    Base.metadata.drop_all(bind=engine)
    init_db()

def _auth_headers(client: TestClient, email: str) -> dict[str, str]:
    password = "StrongPass123!"
    client.post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_alert(client: TestClient, headers: dict[str, str], **overrides: object) -> str:
    payload = {
        "symbol": "NSE:RELIANCE",
        "conditions": [{"field": "price", "operator": "above", "value": 2500, "params": {}}],
        "logic": "AND",
        "delivery_channels": ["in_app"],
        "delivery_config": {},
        "cooldown_minutes": 0,
        "max_triggers": 0,
    }
    payload.update(overrides)
    response = client.post("/api/alerts", headers=headers, json=payload)
    assert response.status_code == 200, response.text
    return response.json()["alert"]["id"]


@pytest.mark.asyncio
async def test_create_alert_with_multiple_conditions_and_and_logic(monkeypatch: pytest.MonkeyPatch) -> None:
    _init_fresh_db()
    client = TestClient(app)
    headers = _auth_headers(client, "alerts-v2-and@example.com")
    alert_id = _create_alert(
        client,
        headers,
        conditions=[
            {"field": "price", "operator": "above", "value": 2500, "params": {}},
            {"field": "change_pct", "operator": "above", "value": 1, "params": {}},
        ],
        logic="AND",
    )

    deliveries: list[str] = []

    async def fake_deliver(alert: AlertORM, message: str, db=None) -> None:  # noqa: ANN001
        deliveries.append(f"{alert.id}:{message}")

    monkeypatch.setattr("backend.alerts.service.deliver_alert", fake_deliver)

    service = AlertEvaluatorService()
    await service._process_tick({"symbol": "NSE:RELIANCE", "ltp": 2600, "change_pct": 0.5, "volume": 100})
    await service._process_tick({"symbol": "NSE:RELIANCE", "ltp": 2605, "change_pct": 1.5, "volume": 100})

    db = SessionLocal()
    try:
      alert = db.query(AlertORM).filter(AlertORM.id == alert_id).one()
      triggers = db.query(AlertTriggerORM).filter(AlertTriggerORM.alert_id == alert_id).all()
      assert len(triggers) == 1
      assert alert.trigger_count == 1
      assert deliveries
    finally:
      db.close()


@pytest.mark.asyncio
async def test_or_logic_triggers_when_any_condition_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    _init_fresh_db()
    client = TestClient(app)
    headers = _auth_headers(client, "alerts-v2-or@example.com")
    alert_id = _create_alert(
        client,
        headers,
        conditions=[
            {"field": "price", "operator": "above", "value": 5000, "params": {}},
            {"field": "change_pct", "operator": "above", "value": 1, "params": {}},
        ],
        logic="OR",
    )

    async def fake_deliver(alert: AlertORM, message: str, db=None) -> None:  # noqa: ANN001
        return None

    monkeypatch.setattr("backend.alerts.service.deliver_alert", fake_deliver)

    service = AlertEvaluatorService()
    await service._process_tick({"symbol": "NSE:RELIANCE", "ltp": 2600, "change_pct": 1.5, "volume": 100})

    db = SessionLocal()
    try:
        triggers = db.query(AlertTriggerORM).filter(AlertTriggerORM.alert_id == alert_id).count()
        assert triggers == 1
    finally:
        db.close()


@pytest.mark.asyncio
async def test_cooldown_prevents_retrigger(monkeypatch: pytest.MonkeyPatch) -> None:
    _init_fresh_db()
    client = TestClient(app)
    headers = _auth_headers(client, "alerts-v2-cooldown@example.com")
    alert_id = _create_alert(client, headers, cooldown_minutes=10)

    async def fake_deliver(alert: AlertORM, message: str, db=None) -> None:  # noqa: ANN001
        return None

    monkeypatch.setattr("backend.alerts.service.deliver_alert", fake_deliver)

    service = AlertEvaluatorService()
    await service._process_tick({"symbol": "NSE:RELIANCE", "ltp": 2600, "change_pct": 0, "volume": 100})
    await service._process_tick({"symbol": "NSE:RELIANCE", "ltp": 2610, "change_pct": 0, "volume": 100})

    db = SessionLocal()
    try:
        assert db.query(AlertTriggerORM).filter(AlertTriggerORM.alert_id == alert_id).count() == 1
    finally:
        db.close()


@pytest.mark.asyncio
async def test_max_triggers_auto_disables_alert(monkeypatch: pytest.MonkeyPatch) -> None:
    _init_fresh_db()
    client = TestClient(app)
    headers = _auth_headers(client, "alerts-v2-max@example.com")
    alert_id = _create_alert(client, headers, max_triggers=1)

    async def fake_deliver(alert: AlertORM, message: str, db=None) -> None:  # noqa: ANN001
        return None

    monkeypatch.setattr("backend.alerts.service.deliver_alert", fake_deliver)

    service = AlertEvaluatorService()
    await service._process_tick({"symbol": "NSE:RELIANCE", "ltp": 2600, "change_pct": 0, "volume": 100})
    await service._process_tick({"symbol": "NSE:RELIANCE", "ltp": 2610, "change_pct": 0, "volume": 100})

    db = SessionLocal()
    try:
        alert = db.query(AlertORM).filter(AlertORM.id == alert_id).one()
        assert alert.status == AlertStatus.EXPIRED.value
        assert alert.trigger_count == 1
    finally:
        db.close()


@pytest.mark.asyncio
async def test_expired_alert_does_not_evaluate(monkeypatch: pytest.MonkeyPatch) -> None:
    _init_fresh_db()
    client = TestClient(app)
    headers = _auth_headers(client, "alerts-v2-expiry@example.com")
    alert_id = _create_alert(client, headers, expiry_date=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat())

    async def fake_deliver(alert: AlertORM, message: str, db=None) -> None:  # noqa: ANN001
        return None

    monkeypatch.setattr("backend.alerts.service.deliver_alert", fake_deliver)

    service = AlertEvaluatorService()
    await service._process_tick({"symbol": "NSE:RELIANCE", "ltp": 2600, "change_pct": 0, "volume": 100})

    db = SessionLocal()
    try:
        alert = db.query(AlertORM).filter(AlertORM.id == alert_id).one()
        assert alert.status == AlertStatus.EXPIRED.value
        assert db.query(AlertTriggerORM).filter(AlertTriggerORM.alert_id == alert_id).count() == 0
    finally:
        db.close()


@pytest.mark.asyncio
async def test_delivery_called_for_external_channels(monkeypatch: pytest.MonkeyPatch) -> None:
    _init_fresh_db()
    client = TestClient(app)
    headers = _auth_headers(client, "alerts-v2-delivery@example.com")
    alert_id = _create_alert(
        client,
        headers,
        delivery_channels=["in_app", "webhook", "telegram", "discord"],
        delivery_config={
            "webhook_url": "https://example.com/hook",
            "telegram_token": "token",
            "telegram_chat_id": "chat-id",
            "discord_webhook_url": "https://discord.example/hook",
        },
    )

    calls: list[tuple[str, str]] = []

    async def fake_deliver(alert: AlertORM, message: str, db=None) -> None:  # noqa: ANN001
        calls.append((alert.id, message))

    monkeypatch.setattr("backend.alerts.service.deliver_alert", fake_deliver)

    service = AlertEvaluatorService()
    await service._process_tick({"symbol": "NSE:RELIANCE", "ltp": 2600, "change_pct": 0, "volume": 100})

    assert calls
    assert calls[0][0] == alert_id


def test_alert_test_endpoint_sends_notification(monkeypatch: pytest.MonkeyPatch) -> None:
    _init_fresh_db()
    client = TestClient(app)
    headers = _auth_headers(client, "alerts-v2-test-endpoint@example.com")
    alert_id = _create_alert(
        client,
        headers,
        delivery_channels=["in_app", "webhook"],
        delivery_config={"webhook_url": "https://example.com/hook"},
    )

    calls: list[tuple[str, str]] = []

    async def fake_deliver(alert: AlertORM, message: str, db=None) -> None:  # noqa: ANN001
        calls.append((alert.id, message))

    monkeypatch.setattr("backend.api.routes.alerts.deliver_alert", fake_deliver)

    response = client.post(f"/api/alerts/{alert_id}/test", headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "sent"
    assert calls == [(alert_id, "Test alert for NSE:RELIANCE")]
