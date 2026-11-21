from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from backend.alerts import service as alert_service
from backend.alerts.service import AlertEvaluatorService
from backend.models import AlertORM, AlertStatus, AlertTriggerORM, User, UserRole
from backend.services.marketdata_hub import MarketDataHub
from backend.shared.db import SessionLocal, init_db


class _FakeSocket:
    def __init__(self, user_id: str) -> None:
        self.state = SimpleNamespace(user_id=user_id)
        self.received: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        self.received.append(payload)

    async def close(self) -> None:
        return None


async def _drain(hub: MarketDataHub) -> None:
    for _ in range(200):
        if all(ch.queue.empty() for ch in hub._clients.values()):  # noqa: SLF001
            break
        await asyncio.sleep(0.005)
    await asyncio.sleep(0.01)


@pytest.mark.asyncio
async def test_process_tick_persists_chart_context_and_emits_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    init_db()
    hub = MarketDataHub()
    service = AlertEvaluatorService()
    service._hub = hub
    symbol = f"NSE:RELIANCE-{uuid4().hex[:8]}".upper()

    async def _noop_process_scanner_tick(*_args, **_kwargs) -> None:
        return None

    monkeypatch.setattr(alert_service, "process_scanner_tick", _noop_process_scanner_tick)

    db = SessionLocal()
    try:
        user = User(email=f"alert-service-context-{uuid4()}@example.com", hashed_password="x", role=UserRole.TRADER)
        db.add(user)
        db.commit()
        db.refresh(user)
        owner_id = str(user.id)

        alert = AlertORM(
            user_id=user.id,
            symbol=symbol,
            condition_type="price_above",
            status=AlertStatus.ACTIVE.value,
            parameters={
                "threshold": 2500,
                "chart_context": {
                    "version": 1,
                    "surface": "chart",
                    "source": "drawing",
                    "symbol": symbol,
                    "market": "NSE",
                    "timeframe": "1D",
                    "panelId": "slot-1",
                    "workspaceId": "slot-1",
                    "sourceLabel": "Horizontal Line",
                    "referencePrice": 2500,
                    "referenceTime": 1700000000,
                },
            },
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
    finally:
        db.close()

    # Owner and another user are both subscribed to the symbol (quote socket) and
    # hold an alert socket; only the owner may receive the alert event.
    owner_quote, owner_alert = _FakeSocket(owner_id), _FakeSocket(owner_id)
    other_quote, other_alert = _FakeSocket("someone-else"), _FakeSocket("someone-else")
    hub._connections[owner_quote] = {symbol}  # noqa: SLF001
    hub._connections[other_quote] = {symbol}  # noqa: SLF001
    hub._alert_connections.update({owner_alert, other_alert})  # noqa: SLF001

    await service._process_tick({"symbol": symbol, "ltp": 2550, "volume": 1000, "change_pct": 1.1})

    db = SessionLocal()
    try:
        trigger = db.query(AlertTriggerORM).filter(AlertTriggerORM.alert_id == alert.id).first()
        assert trigger is not None
        assert trigger.context["chart_context"]["source"] == "drawing"
        assert trigger.context["threshold"] == 2500
        assert trigger.context["tick"]["ltp"] == 2550
    finally:
        db.close()

    await _drain(hub)
    for sock in (owner_quote, owner_alert):
        events = [item for item in sock.received if item.get("type") == "alert_triggered"]
        assert len(events) == 1
        payload = events[0]
        assert payload["alert_id"] == alert.id
        assert payload["user_id"] == owner_id
        assert payload["payload"]["chart_context"]["panelId"] == "slot-1"
        assert payload["payload"]["chart_context"]["source"] == "drawing"
    for sock in (other_quote, other_alert):
        assert not [item for item in sock.received if item.get("type") == "alert_triggered"]

    for task in [ch.task for ch in hub._clients.values() if ch.task]:  # noqa: SLF001
        task.cancel()
