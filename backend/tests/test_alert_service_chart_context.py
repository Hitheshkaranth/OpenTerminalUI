from __future__ import annotations

from uuid import uuid4

import pytest

from backend.alerts import service as alert_service
from backend.alerts.service import AlertEvaluatorService
from backend.models import AlertORM, AlertStatus, AlertTriggerORM, User, UserRole
from backend.shared.db import SessionLocal, init_db


class _FakeHub:
    def __init__(self) -> None:
        self.alert_payloads: list[dict] = []
        self.symbol_payloads: list[tuple[str, dict]] = []

    async def broadcast_alert(self, payload: dict) -> None:
        self.alert_payloads.append(payload)

    async def broadcast(self, symbol: str, payload: dict) -> None:
        self.symbol_payloads.append((symbol, payload))


@pytest.mark.asyncio
async def test_process_tick_persists_chart_context_and_emits_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    init_db()
    hub = _FakeHub()
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

    assert hub.alert_payloads
    payload = next(item for item in hub.alert_payloads if item["alert_id"] == alert.id)
    assert payload["payload"]["chart_context"]["panelId"] == "slot-1"
    assert payload["payload"]["chart_context"]["source"] == "drawing"
    assert any(channel_symbol == symbol for channel_symbol, _ in hub.symbol_payloads)
