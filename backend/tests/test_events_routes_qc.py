from __future__ import annotations

import asyncio
from datetime import date

import pytest
from fastapi import HTTPException

from backend.equity.routes import events
from backend.equity.services.corporate_actions import CorporateEvent, EventType


def _event(symbol: str, event_type: EventType, day: date) -> CorporateEvent:
    return CorporateEvent(
        symbol=symbol,
        event_type=event_type,
        title=f"{event_type.value} event",
        description="desc",
        event_date=day,
        source="test",
        impact="neutral",
    )


def test_get_stock_events_returns_items(monkeypatch) -> None:
    async def _fake_get_events(symbol: str, event_types=None, from_date=None, to_date=None, include_upcoming=True):  # noqa: ANN001, ARG001
        assert symbol == "RELIANCE"
        return [_event("RELIANCE", EventType.DIVIDEND, date(2025, 1, 15))]

    monkeypatch.setattr(events.corporate_actions_service, "get_events", _fake_get_events)
    out = asyncio.run(events.get_stock_events("RELIANCE", types="dividend", from_date="2025-01-01", to_date="2025-12-31"))
    assert out["count"] == 1
    assert out["items"][0]["event_type"] == "dividend"


def test_get_stock_events_rejects_invalid_type() -> None:
    with pytest.raises(HTTPException):
        asyncio.run(events.get_stock_events("RELIANCE", types="not_a_type"))


def test_portfolio_events_endpoint(monkeypatch) -> None:
    async def _fake_portfolio(symbols: list[str], days_ahead: int = 30):
        assert symbols == ["RELIANCE", "TCS"]
        assert days_ahead == 30
        return [
            _event("TCS", EventType.BOARD_MEETING, date(2025, 2, 2)),
            _event("RELIANCE", EventType.DIVIDEND, date(2025, 2, 5)),
        ]

    monkeypatch.setattr(events.corporate_actions_service, "get_portfolio_events", _fake_portfolio)
    out = asyncio.run(events.get_portfolio_events("RELIANCE,TCS", days=30))
    assert out["count"] == 2
    assert out["items"][0]["symbol"] == "TCS"
