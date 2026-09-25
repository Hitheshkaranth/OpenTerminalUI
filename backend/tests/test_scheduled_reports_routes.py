from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.reports.routes import router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return TestClient(app)


def test_scheduled_reports_crud_roundtrip():
    c = _client()
    assert c.get("/api/reports/scheduled").status_code == 200
    r = c.post("/api/reports/scheduled", json={"report_type": "portfolio_summary", "frequency": "daily", "email": "a@b.co", "data_type": "positions"})
    assert r.status_code == 200, r.text
    cfg = r.json()
    assert {"id", "report_type", "frequency", "email", "enabled", "data_type"} <= set(cfg)
    assert any(i["id"] == cfg["id"] for i in c.get("/api/reports/scheduled").json()["items"])
    assert c.delete(f"/api/reports/scheduled/{cfg['id']}").status_code == 200
    assert c.delete(f"/api/reports/scheduled/{cfg['id']}").status_code == 404


def test_scheduled_reports_rejects_bad_frequency():
    c = _client()
    r = c.post("/api/reports/scheduled", json={"report_type": "x", "frequency": "hourly", "email": "a@b.co"})
    assert r.status_code == 422


def test_watchlist_singular_alias_is_mounted():
    from backend.main import app

    # Read the OpenAPI paths: newer FastAPI keeps included routers nested in app.routes.
    paths = set(app.openapi()["paths"])
    assert "/api/watchlist" in paths and "/api/watchlists" in paths


def test_depth_snapshot_declares_itself_synthetic():
    """The order-book service is generated data; the wire format must say so."""
    from backend.services.orderbook_service import service

    wire = service.get_snapshot("RELIANCE", market_hint="NSE", levels=5).to_wire()
    assert wire["synthetic"] is True
    assert wire["provenance"]["quality"] == "synthetic"
    assert wire["provenance"]["source"] == "mock"


def test_depth_snapshot_centres_on_ref_price():
    from backend.services.orderbook_service import service

    wire = service.get_snapshot("RELIANCE", market_hint="US", levels=5, ref_price=1246.5).to_wire()
    assert abs(wire["mid_price"] - 1246.5) < 1.0
    assert wire["bids"][0]["price"] < 1246.5 < wire["asks"][0]["price"]
    default = service.get_snapshot("RELIANCE", market_hint="US", levels=5).to_wire()
    assert abs(default["mid_price"] - 1246.5) > 100  # seeded base is unrelated without ref_price


def test_depth_snapshot_sub_dollar_ref_price_stays_positive():
    from backend.services.orderbook_service import service

    for ref in (0.15, 0.0000123):
        wire = service.get_snapshot("SUBDOLLAR-USD", market_hint="CRYPTO", levels=40, ref_price=ref).to_wire()
        assert abs(wire["mid_price"] - ref) < ref * 0.01
        assert all(level["price"] > 0 for level in wire["bids"])
        assert wire["bids"][0]["price"] < ref < wire["asks"][0]["price"]


def test_create_watchlist_keeps_symbols(monkeypatch):
    """POST /api/watchlists used to discard the symbols in the payload."""
    from types import SimpleNamespace

    from backend.api.routes import watchlists as mod

    stored = {}

    class FakeDB:
        def add(self, row):
            stored["row"] = row

        def commit(self):
            pass

        def refresh(self, row):
            pass

    payload = mod.WatchlistCreate(name="Core", symbols=[" reliance", "TCS", "tcs", ""], column_config={})
    out = mod.create_watchlist(payload, db=FakeDB(), current_user=SimpleNamespace(id="u1"))
    assert out["symbols"] == ["RELIANCE", "TCS"]


def test_chart_falls_back_to_classifier_when_market_hint_yields_nothing(monkeypatch):
    """/api/chart/MSFT?market=NSE returned 0 bars; it must retry without the hint."""
    import asyncio
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from backend.api.routes import chart as mod

    calls = []

    class Provider:
        async def get_ohlcv(self, ticker, interval, period, start, end, market_hint):
            calls.append(market_hint)
            if market_hint:
                return []
            return [SimpleNamespace(timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc), open=1, high=2, low=0.5, close=1.5, volume=10)]

    async def fake_provider():
        return Provider()

    monkeypatch.setattr(mod, "get_chart_provider", fake_provider)
    out = asyncio.run(mod.get_chart("MSFT", market="NSE", interval="1d", range="1y", period="3mo", start=None, end=None, normalized=True))
    assert out["count"] == 1 and calls == ["NSE", None]
    assert out["market_hint"] == ""


def test_every_top_level_spa_route_is_served_as_the_app():
    """Any top-level React route must map to app.html, not the marketing landing page."""
    import re
    from pathlib import Path

    from backend.main import _frontend_app_entry_paths

    app_tsx = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "App.tsx").read_text()
    top_level = {m for m in re.findall(r'path="/([a-z-]+)"', app_tsx)}
    missing = sorted(top_level - _frontend_app_entry_paths)
    assert not missing, f"routes not served as SPA: {missing}"


def test_monthly_frequency_gets_monthly_trigger_not_12h():
    from backend.reports.scheduler import ScheduledReportsService

    trig = str(ScheduledReportsService()._trigger_for_frequency("monthly"))
    assert "day='last'" in trig and "*/12" not in trig


def test_send_email_starttls_verifies_certificates(monkeypatch):
    import ssl

    from backend.reports import scheduler as sched

    seen = {}

    class _FakeSMTP:
        def __init__(self, *a, **k): ...
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self, context=None): seen["ctx"] = context
        def login(self, *a): ...
        def send_message(self, *a): ...

    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_USER", "u@example.com")
    monkeypatch.setenv("SMTP_PASSWORD", "pw")
    monkeypatch.setattr(sched.smtplib, "SMTP", _FakeSMTP)
    sched.ScheduledReportsService().send_email("a@b.co", "s", "b", "r.csv", b"x")
    assert seen["ctx"] is not None and seen["ctx"].verify_mode == ssl.CERT_REQUIRED
