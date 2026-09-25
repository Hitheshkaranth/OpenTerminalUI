from __future__ import annotations

from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import dividends as div_routes
from backend.equity.services.corporate_actions import CorporateEvent, EventType


def _evt(symbol: str, ex: date, value: str | None = "INR 10", kind: EventType = EventType.DIVIDEND) -> CorporateEvent:
    return CorporateEvent(
        symbol=symbol, event_type=kind, title="Final Dividend", description="", event_date=ex, ex_date=ex, value=value, source="nse"
    )


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(div_routes.router, prefix="/api")
    return TestClient(app)


def test_calendar_only_returns_real_dividends_inside_window(monkeypatch) -> None:
    today = date.today()
    events = [
        _evt("TCS", today + timedelta(days=5), "Rs 28.50 per share"),
        _evt("INFY", today + timedelta(days=45)),  # outside 30d window
        _evt("ITC", today - timedelta(days=10)),  # already past
        _evt("LT", today + timedelta(days=3), kind=EventType.BONUS),
    ]

    async def _fake(symbols, days_ahead=30):
        return events

    monkeypatch.setattr(div_routes.corporate_actions_service, "get_portfolio_events", _fake)
    rows = _client().get("/api/dividends/calendar").json()

    assert rows == [
        {"symbol": "TCS", "ex_date": (today + timedelta(days=5)).isoformat(), "amount": 28.5, "type": "Final Dividend", "source": "nse"}
    ]


def test_calendar_is_empty_when_source_has_nothing(monkeypatch) -> None:
    async def _fake(symbols, days_ahead=30):
        return []

    monkeypatch.setattr(div_routes.corporate_actions_service, "get_portfolio_events", _fake)
    assert _client().get("/api/dividends/calendar").json() == []


def test_history_is_symbol_specific_and_past_only(monkeypatch) -> None:
    today = date.today()
    seen: list[str] = []

    async def _fake(symbol):
        seen.append(symbol)
        return [_evt(symbol, date(2024, 8, 1), "INR 9"), _evt(symbol, date(2023, 8, 1), "INR 8"), _evt(symbol, today + timedelta(days=9))]

    monkeypatch.setattr(div_routes.corporate_actions_service, "get_dividend_history", _fake)
    rows = _client().get("/api/dividends/history/reliance").json()

    assert seen == ["RELIANCE"]
    assert rows == [{"date": "2023-08-01", "amount": 8.0}, {"date": "2024-08-01", "amount": 9.0}]


def test_consecutive_growth_years() -> None:
    last = date.today().year - 1
    history = [{"date": f"{last - i}-06-01", "amount": 10.0 - i} for i in range(5)]
    assert div_routes._consecutive_growth_years(history) == 4
