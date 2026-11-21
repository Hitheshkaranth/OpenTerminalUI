"""Cross-tenant scoping: every holdings/tax-lot/watchlist reader returns only the caller's rows.

Two users each own distinct tickers; each scoped route or function must return only the
caller's tickers. Session factories are patched per module (never ``backend.shared.db``).
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.agent.tools import analytics_tools, portfolio_tools, risk_tools
from backend.api.deps import get_db
from backend.api.routes import analytics as analytics_routes
from backend.api.routes import dividends as dividends_routes
from backend.api.routes import risk as risk_routes
from backend.api.routes import stress_test as stress_routes
from backend.auth.deps import get_current_user
from backend.mcp import resources as mcp_resources
from backend.models import Holding, TaxLot, WatchlistItem
from backend.plugins.context import PluginContextImpl
from backend.reports.generator import rows_for_data_type
from backend.services.stress_test_service import stress_test_service
from backend.shared.db import Base

USER_A = "user-a"
USER_B = "user-b"
TICKERS = {USER_A: {"AAPL", "MSFT"}, USER_B: {"TSLA", "XOM"}}


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = factory()
    for user_id, tickers in TICKERS.items():
        for ticker in sorted(tickers):
            db.add(Holding(user_id=user_id, ticker=ticker, quantity=10, avg_buy_price=100.0, buy_date="2025-01-02"))
            db.add(TaxLot(user_id=user_id, ticker=ticker, quantity=10, remaining_quantity=10, buy_price=100.0, buy_date="2025-01-02"))
            db.add(WatchlistItem(user_id=user_id, watchlist_name="core", ticker=ticker))
    db.commit()
    db.close()
    yield factory
    engine.dispose()


def _client(router, factory, user_id: str, prefix: str = "/api") -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix=prefix)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=user_id, role="trader")
    return TestClient(app)


@pytest.mark.parametrize("user_id", [USER_A, USER_B])
def test_risk_portfolio_route_uses_only_callers_holdings(session_factory, monkeypatch, user_id):
    seen: list[str] = []

    async def _fake_frame(symbols):
        seen.extend(symbols)
        return pd.DataFrame()

    monkeypatch.setattr(risk_routes, "_load_returns_frame", _fake_frame)
    res = _client(risk_routes.router, session_factory, user_id).post("/api/risk/portfolio", json={})
    assert res.status_code == 404  # no returns in the fake; we only care which symbols were requested
    assert set(seen) == TICKERS[user_id]


@pytest.mark.parametrize("user_id", [USER_A, USER_B])
def test_risk_stress_test_route_scoped(session_factory, user_id):
    client = _client(risk_routes.router, session_factory, user_id)
    res = client.post("/api/risk/stress-test", json={"scenario": "2008_gfc"})
    assert res.status_code == 200
    assert {h["symbol"] for h in res.json()["holdings"]} == TICKERS[user_id]
    replay = client.post("/api/risk/stress-test/replay", json={"scenario": "2008_gfc"})
    assert replay.status_code == 200


@pytest.mark.parametrize("user_id", [USER_A, USER_B])
def test_analytics_stress_route_scoped(session_factory, monkeypatch, user_id):
    seen: list[str] = []

    async def _fake_load_returns(symbols, benchmark="SPY"):
        seen.extend(symbols)
        return pd.DataFrame(), pd.Series(dtype=float)

    monkeypatch.setattr(analytics_routes, "_load_returns", _fake_load_returns)
    res = _client(analytics_routes.router, session_factory, user_id, prefix="").post(
        "/api/analytics/stress-test", json={"scenario_type": "flash_crash"}
    )
    assert res.status_code == 400
    assert set(seen) == TICKERS[user_id]


@pytest.mark.parametrize("user_id", [USER_A, USER_B])
def test_dividends_portfolio_income_scoped(session_factory, monkeypatch, user_id):
    from backend.services.portfolio_analytics import portfolio_analytics_service

    seen: list[str] = []

    async def _fake_tracker(holdings, days=365):
        seen.extend(h.ticker for h in holdings)
        return {"upcoming": [], "annual_income_projection": 0.0}

    monkeypatch.setattr(portfolio_analytics_service, "dividend_tracker", _fake_tracker)
    res = _client(dividends_routes.router, session_factory, user_id).get("/api/dividends/portfolio-income")
    assert res.status_code == 200
    assert res.json()["holdings_count"] == 2
    assert set(seen) == TICKERS[user_id]


@pytest.mark.parametrize("user_id", [USER_A, USER_B])
def test_stress_test_routes_and_service_scoped(session_factory, user_id):
    db = session_factory()
    try:
        assert {h["ticker"] for h in stress_routes._load_holdings(db, "current", user_id)} == TICKERS[user_id]
        holdings, _ = stress_test_service.resolve_portfolio_holdings(db, "current", user_id=user_id)
        assert {h.ticker for h in holdings} == TICKERS[user_id]
        with pytest.raises(LookupError):
            stress_test_service.resolve_portfolio_holdings(db, "current")  # no user -> nothing
    finally:
        db.close()
    res = _client(stress_routes.router, session_factory, user_id).post(
        "/api/risk/scenarios/run", json={"custom_shocks": {"equity": -0.1}}
    )
    assert res.status_code == 200
    assert {h["symbol"] for h in res.json()["by_holding"]} == TICKERS[user_id]


@pytest.mark.parametrize("user_id", [USER_A, USER_B])
def test_agent_portfolio_and_risk_tools_scoped(session_factory, monkeypatch, user_id):
    monkeypatch.setattr(portfolio_tools, "SessionLocal", session_factory)
    monkeypatch.setattr(risk_tools, "SessionLocal", session_factory)

    snap = portfolio_tools._holdings_snapshot(user_id)
    assert {i["ticker"] for i in snap["items"]} == TICKERS[user_id]
    assert portfolio_tools._holdings_snapshot("")["items"] == []

    resolved = risk_tools._resolve_holdings(None, user_id=user_id)
    assert {h.ticker for h in resolved[0]} == TICKERS[user_id]
    out = risk_tools._run_stress_test({"scenario": "2008_gfc"}, user_id=user_id)
    assert {h["symbol"] for h in out["data"]["holdings"]} == TICKERS[user_id]
    assert risk_tools._resolve_holdings(None)["error"]["code"] == "not_found"


def test_agent_factor_analysis_without_user_never_reads_all(session_factory, monkeypatch):
    monkeypatch.setattr(analytics_tools, "SessionLocal", session_factory)
    seen: list[str] = []

    async def _fake_universe(tickers, period):
        seen.extend(tickers)
        return {"ok": False, "error": {"code": "stub"}}

    monkeypatch.setattr(analytics_tools, "_load_universe", _fake_universe)
    out = asyncio.run(analytics_tools.run_factor_analysis({}))
    assert out["error"]["code"] == "empty_portfolio"
    asyncio.run(analytics_tools.run_factor_analysis({}, user_id=USER_B))
    assert set(seen) == TICKERS[USER_B]


@pytest.mark.parametrize("user_id", [USER_A, USER_B])
def test_mcp_portfolio_resource_scoped(session_factory, monkeypatch, user_id):
    monkeypatch.setattr(mcp_resources, "SessionLocal", session_factory)
    out = mcp_resources.read_resource("otui://portfolio/default", user_id)
    assert {i["ticker"] for i in out["data"]["items"]} == TICKERS[user_id]


@pytest.mark.parametrize("user_id", [USER_A, USER_B])
def test_report_generator_scoped(session_factory, user_id):
    db = session_factory()
    try:
        for kind in ("positions", "watchlist", "tax_lots"):
            rows = rows_for_data_type(db, kind, user_id=user_id)
            assert {r["ticker"] for r in rows} == TICKERS[user_id], kind
            assert rows_for_data_type(db, kind) == []
    finally:
        db.close()


def test_plugin_context_read_portfolio_scoped(session_factory):
    ctx = PluginContextImpl(db_factory=session_factory, permissions={"read_portfolio"}, user_id=USER_A)
    items = asyncio.run(ctx.read_portfolio())["items"]
    assert {i["ticker"] for i in items} == TICKERS[USER_A]
    anon = PluginContextImpl(db_factory=session_factory, permissions={"read_portfolio"})
    assert asyncio.run(anon.read_portfolio()) == {"items": []}
