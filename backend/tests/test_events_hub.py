from __future__ import annotations

import asyncio
import re
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import events_hub as events_hub_router_module
from backend.services import events_hub
from backend.services.events_hub import make_event_id


# ---------------------------------------------------------------------------
# Helpers — mock data factories
# ---------------------------------------------------------------------------

def _earnings_mock(symbol, company, days_offset, time="bmo", estimated_eps=1.23):
    d = date.today() + timedelta(days=days_offset)
    return type("E", (), {
        "symbol": symbol, "company_name": company, "earnings_date": d,
        "fiscal_quarter": "Q2 FY2026", "fiscal_year": 2026, "quarter": 2,
        "estimated_eps": estimated_eps, "actual_eps": None,
        "time": time, "source": "finnhub",
    })()


def _corporate_mock(symbol, event_type, days_offset, impact="positive", ex_date=None, value=None):
    d = date.today() + timedelta(days=days_offset)
    return type("CE", (), {
        "symbol": symbol, "event_type": type("ET", (), {"value": event_type})(),
        "title": f"{event_type} event for {symbol}", "description": f"Description for {symbol}",
        "event_date": d, "ex_date": ex_date or d, "record_date": d,
        "payment_date": d, "value": value, "source": "nse", "impact": impact,
        "url": None,
    })()


def _macro_mock(country, event_name, days_offset, impact="high", time_val="14:00:00"):
    d = date.today() + timedelta(days=days_offset)
    return {
        "date": d.isoformat(), "time": time_val, "country": country,
        "event_name": event_name, "impact": impact, "actual": None,
        "forecast": None, "previous": None,
    }


# ---------------------------------------------------------------------------
# 1. Merge + sort order across all four sources
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_merge_sort_across_sources(monkeypatch):
    async def _get_earnings(self, syms, days):
        return [_earnings_mock("RELIANCE", "Reliance Industries", 5, "bmo", 100.0)]

    async def _get_corporate(self, syms, days):
        return [
            _corporate_mock("TCS", "dividend", 3, "positive", ex_date=date.today() + timedelta(days=3)),
            _corporate_mock("HDFC", "split", 10, "neutral", ex_date=date.today() + timedelta(days=10)),
        ]

    async def _expiry():
        return {"items": [{"symbol": "NIFTY", "expiry_date": (date.today() + timedelta(days=7)).isoformat(), "days_to_expiry": 7}]}

    async def _get_calendar(self, s, e):
        return [_macro_mock("US", "CPI", 2, "high", "08:30:00"), _macro_mock("IN", "RBI Rate", 4, "medium", "10:00:00")]

    monkeypatch.setattr(events_hub, "earnings_service", type("S", (), {"get_portfolio_earnings": _get_earnings})())
    monkeypatch.setattr(events_hub, "corporate_actions_service", type("S", (), {"get_portfolio_events": _get_corporate})())
    monkeypatch.setattr(events_hub, "expiry_dashboard", _expiry)
    monkeypatch.setattr(events_hub, "get_economic_data_service", lambda: type("S", (), {"get_economic_calendar": _get_calendar})())

    result = await events_hub.get_upcoming_events(
        symbols=["RELIANCE", "TCS"], days=30,
        types={"earnings", "dividend", "corporate", "expiry", "macro"},
    )

    items = result["items"]
    assert len(items) >= 4

    impact_order = {"high": 0, "medium": 1, "low": 2, "neutral": 3}
    for i in range(len(items) - 1):
        d1, d2 = items[i]["date"], items[i + 1]["date"]
        if d1 == d2:
            assert impact_order[items[i]["impact"]] <= impact_order[items[i + 1]["impact"]]

    types_found = {it["type"] for it in items}
    assert "earnings" in types_found
    assert "dividend" in types_found
    assert "macro" in types_found
    assert result["errors"] == []


# ---------------------------------------------------------------------------
# 2. One source raising
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_one_source_raises(monkeypatch):
    async def _get_earnings(self, syms, days):
        raise ConnectionError("upstream unavailable")

    async def _get_corporate(self, syms, days):
        return []

    async def _expiry():
        return {"items": []}

    async def _get_calendar(self, s, e):
        return []

    monkeypatch.setattr(events_hub, "earnings_service", type("S", (), {"get_portfolio_earnings": _get_earnings})())
    monkeypatch.setattr(events_hub, "corporate_actions_service", type("S", (), {"get_portfolio_events": _get_corporate})())
    monkeypatch.setattr(events_hub, "expiry_dashboard", _expiry)
    monkeypatch.setattr(events_hub, "get_economic_data_service", lambda: type("S", (), {"get_economic_calendar": _get_calendar})())

    result = await events_hub.get_upcoming_events(
        symbols=["RELIANCE"], days=30,
        types={"earnings", "dividend", "corporate", "expiry", "macro"},
    )

    error_sources = {e["source"] for e in result["errors"]}
    assert "earnings_service" in error_sources
    assert isinstance(result["items"], list)


# ---------------------------------------------------------------------------
# 3. Source timeout
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_source_timeout(monkeypatch):
    async def _hang(*args, **kwargs):
        await asyncio.sleep(30)
        return []

    monkeypatch.setattr(events_hub, "earnings_service", type("S", (), {"get_portfolio_earnings": _hang})())
    monkeypatch.setattr(events_hub, "corporate_actions_service", type("S", (), {"get_portfolio_events": _hang})())
    monkeypatch.setattr(events_hub, "expiry_dashboard", _hang)

    async def _get_calendar(self, s, e):
        return [_macro_mock("US", "GDP", 3, "high")]

    monkeypatch.setattr(events_hub, "get_economic_data_service", lambda: type("S", (), {"get_economic_calendar": _get_calendar})())

    t0 = asyncio.get_event_loop().time()
    result = await events_hub.get_upcoming_events(
        symbols=["AAPL"], days=30,
        types={"earnings", "dividend", "corporate", "expiry", "macro"},
    )
    elapsed = asyncio.get_event_loop().time() - t0

    assert elapsed < 8, f"Event hub took {elapsed:.1f}s, expected < 8s"

    error_sources = {e["source"] for e in result["errors"]}
    assert "earnings_service" in error_sources
    assert "corporate_actions" in error_sources
    assert "fno" in error_sources

    macro_items = [it for it in result["items"] if it["type"] == "macro"]
    assert len(macro_items) >= 1


# ---------------------------------------------------------------------------
# 4. Date window filtering
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_date_window_filtering(monkeypatch):
    async def _get_earnings(self, syms, days):
        return [
            _earnings_mock("AAPL", "Apple Inc.", 0, "amc"),
            _earnings_mock("GOOGL", "Alphabet", 29, "bmo"),
            _earnings_mock("MSFT", "Microsoft", 31, "bmo"),
            _earnings_mock("META", "Meta", 50, "bmo"),
        ]

    async def _get_corporate(self, syms, days):
        return []

    async def _expiry():
        return {"items": []}

    async def _get_calendar(self, s, e):
        return []

    monkeypatch.setattr(events_hub, "earnings_service", type("S", (), {"get_portfolio_earnings": _get_earnings})())
    monkeypatch.setattr(events_hub, "corporate_actions_service", type("S", (), {"get_portfolio_events": _get_corporate})())
    monkeypatch.setattr(events_hub, "expiry_dashboard", _expiry)
    monkeypatch.setattr(events_hub, "get_economic_data_service", lambda: type("S", (), {"get_economic_calendar": _get_calendar})())

    result = await events_hub.get_upcoming_events(
        symbols=["AAPL", "GOOGL", "MSFT", "META"], days=30, types={"earnings"},
    )

    sym_dates = {it["symbol"]: it["date"] for it in result["items"]}

    assert "AAPL" in sym_dates, "Today event should be included"
    assert date.fromisoformat(sym_dates["AAPL"]) == date.today()
    assert "GOOGL" in sym_dates
    assert "MSFT" not in sym_dates, "Event beyond cutoff should be excluded"
    assert "META" not in sym_dates


# ---------------------------------------------------------------------------
# 5. Type filter: dividend vs corporate
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_type_filter_dividend_vs_corporate(monkeypatch):
    async def _get_earnings(self, syms, days):
        return []

    async def _get_corporate(self, syms, days):
        return [
            _corporate_mock("TCS", "dividend", 5, "positive", ex_date=date.today() + timedelta(days=5)),
            _corporate_mock("INFY", "split", 7, "neutral", ex_date=date.today() + timedelta(days=7)),
            _corporate_mock("HDFC", "bonus", 10, "positive", ex_date=date.today() + timedelta(days=10)),
            _corporate_mock("WIPRO", "rights", 12, "neutral", ex_date=date.today() + timedelta(days=12)),
        ]

    async def _expiry():
        return {"items": []}

    async def _get_calendar(self, s, e):
        return []

    monkeypatch.setattr(events_hub, "earnings_service", type("S", (), {"get_portfolio_earnings": _get_earnings})())
    monkeypatch.setattr(events_hub, "corporate_actions_service", type("S", (), {"get_portfolio_events": _get_corporate})())
    monkeypatch.setattr(events_hub, "expiry_dashboard", _expiry)
    monkeypatch.setattr(events_hub, "get_economic_data_service", lambda: type("S", (), {"get_economic_calendar": _get_calendar})())

    result_div = await events_hub.get_upcoming_events(
        symbols=["TCS", "INFY"], days=30, types={"dividend"},
    )
    div_types = {it["type"] for it in result_div["items"]}
    assert div_types == {"dividend"}

    result_corp = await events_hub.get_upcoming_events(
        symbols=["TCS", "INFY", "HDFC"], days=30, types={"corporate"},
    )
    corp_types = {it["type"] for it in result_corp["items"]}
    assert "split" in corp_types
    assert "bonus" in corp_types
    assert "dividend" not in corp_types


# ---------------------------------------------------------------------------
# 6. Dedupe by id
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_dedupe_by_id(monkeypatch):
    async def _get_earnings(self, syms, days):
        return [
            _earnings_mock("AAPL", "Apple", 5, "bmo", 2.0),
            _earnings_mock("AAPL", "Apple Co", 5, "amc", 2.1),
        ]

    async def _get_corporate(self, syms, days):
        return []

    async def _expiry():
        return {"items": []}

    async def _get_calendar(self, s, e):
        return []

    monkeypatch.setattr(events_hub, "earnings_service", type("S", (), {"get_portfolio_earnings": _get_earnings})())
    monkeypatch.setattr(events_hub, "corporate_actions_service", type("S", (), {"get_portfolio_events": _get_corporate})())
    monkeypatch.setattr(events_hub, "expiry_dashboard", _expiry)
    monkeypatch.setattr(events_hub, "get_economic_data_service", lambda: type("S", (), {"get_economic_calendar": _get_calendar})())

    result = await events_hub.get_upcoming_events(
        symbols=["AAPL"], days=30, types={"earnings"},
    )

    ids = [it["id"] for it in result["items"]]
    assert len(ids) == len(set(ids)), "Should dedupe by id"
    assert len(result["items"]) == 1


# ---------------------------------------------------------------------------
# 7. make_event_id slug rules
# ---------------------------------------------------------------------------

def test_make_event_id_slug():
    eid = make_event_id("earnings", "AAPL", "2025-06-15", "Q2 earnings beat")
    assert eid == "earnings:AAPL:2025-06-15:q2-earnings-beat"

    eid2 = make_event_id("macro", None, "2025-01-15", "US CPI (core)")
    assert eid2 == "macro:GLOBAL:2025-01-15:us-cpi-core"

    eid3 = make_event_id("macro", None, "2025-01-15", "café inflation")
    assert re.match(r"^macro:GLOBAL:2025-01-15:[a-z0-9-]+$", eid3), eid3

    eid4 = make_event_id("earnings", "VERYLONGCOMPANYNAME", "2025-06-15", "Very long title that should be truncated " * 3)
    assert len(eid4.split(":")[-1]) <= 40


# ---------------------------------------------------------------------------
# 8. Route: unknown types ignored, days>365 → 422
# ---------------------------------------------------------------------------

def test_route_unknown_types_ignored():
    app = FastAPI()
    app.include_router(events_hub_router_module.router, prefix="/api")
    client = TestClient(app)

    resp = client.get("/api/events-hub/upcoming?days=1&types=unicorn,dragon,pegasus")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert "items" in body
    assert "errors" in body

    resp2 = client.get("/api/events-hub/upcoming?days=1&types=earnings,unicorn")
    assert resp2.status_code == 200


def test_route_days_422():
    app = FastAPI()
    app.include_router(events_hub_router_module.router, prefix="/api")
    client = TestClient(app)

    resp = client.get("/api/events-hub/upcoming?days=400")
    assert resp.status_code == 422

    resp2 = client.get("/api/events-hub/upcoming?days=0")
    assert resp2.status_code == 422

def test_ids_do_not_collide_for_same_day_events_with_long_shared_prefix():
    from backend.services.events_hub import make_event_id

    a = make_event_id("macro", None, "2026-10-01", "US ISM Manufacturing PMI")
    b = make_event_id("macro", None, "2026-10-01", "US ISM Manufacturing Prices Paid")
    assert a != b
    assert a.startswith("macro:GLOBAL:2026-10-01:")


def test_malformed_date_from_one_source_drops_only_that_item(monkeypatch):
    import asyncio
    from datetime import date, timedelta
    from types import SimpleNamespace

    from backend.services import events_hub as mod

    good = date.today() + timedelta(days=2)

    async def earnings(symbols, days):
        return [
            SimpleNamespace(symbol="AAPL", earnings_date="", fiscal_quarter="Q4", fiscal_year=2026, estimated_eps=1.0, company_name="Apple", time="amc"),
            SimpleNamespace(symbol="MSFT", earnings_date=good, fiscal_quarter="Q1", fiscal_year=2027, estimated_eps=2.0, company_name="Microsoft", time="bmo"),
        ]

    async def none(*a, **k):
        return []

    monkeypatch.setattr(mod.earnings_service, "get_portfolio_earnings", earnings)
    monkeypatch.setattr(mod.corporate_actions_service, "get_portfolio_events", none)
    out = asyncio.run(mod.get_upcoming_events(["AAPL", "MSFT"], days=10, types={"earnings", "dividend"}))
    assert [i["symbol"] for i in out["items"]] == ["MSFT"]
    assert out["errors"] == []


def test_timeout_reason_is_not_empty(monkeypatch):
    import asyncio

    from backend.services import events_hub as mod

    async def slow(*a, **k):
        await asyncio.sleep(30)

    monkeypatch.setattr(mod.earnings_service, "get_portfolio_earnings", slow)
    out = asyncio.run(mod.get_upcoming_events(["AAPL"], days=10, types={"earnings"}))
    assert out["errors"] and out["errors"][0]["reason"]
