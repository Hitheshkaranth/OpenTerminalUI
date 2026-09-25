from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.reports import routes as report_routes
from backend.services import events_hub


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(report_routes.router, prefix="/api")
    return TestClient(app)


def test_dashboard_events_come_from_events_hub(monkeypatch) -> None:
    async def _fake(symbols, days=30, types=None):
        assert "RELIANCE" in symbols
        return {"items": [{"date": "2026-10-02", "symbol": "TCS", "title": "Q2 FY27 earnings", "type": "earnings"}], "errors": []}

    monkeypatch.setattr(events_hub, "get_upcoming_events", _fake)
    assert _client().get("/api/reports/events").json() == [{"date": "2026-10-02", "ticker": "TCS", "event": "Q2 FY27 earnings"}]


def test_dashboard_events_empty_when_sources_fail(monkeypatch) -> None:
    async def _boom(*args, **kwargs):
        raise RuntimeError("down")

    monkeypatch.setattr(events_hub, "get_upcoming_events", _boom)
    assert _client().get("/api/reports/events").json() == []
