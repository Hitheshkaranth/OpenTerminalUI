from __future__ import annotations

import asyncio

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes import kite as kite_routes
from backend.auth.deps import get_current_user
from backend.core.kite_client import KiteClient
from backend.models import AuditLogORM, Holding, OmsFillORM, OmsOrderORM, RestrictedListORM
from backend.oms import routes as oms
from backend.risk_engine import routes as risk_routes
from backend.shared.db import Base


def _user(uid: str = "u_test", role: str = "trader"):
    return type("FakeUser", (), {"id": uid, "role": role})()


def _build_oms(monkeypatch, price: float | None = 100.0, role: str = "trader"):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    app = FastAPI()
    app.include_router(oms.router, prefix="/api")

    async def _snap(_: str):
        return {"current_price": price, "market_cap": 1_000_000_000_000}

    monkeypatch.setattr(oms, "fetch_stock_snapshot_coalesced", _snap)

    def _db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: _user(role=role)
    return TestClient(app), SessionLocal


# ---- REL-11 ---------------------------------------------------------------

def test_no_market_price_is_503_even_with_limit_price(monkeypatch):
    client, SessionLocal = _build_oms(monkeypatch, price=None)
    resp = client.post(
        "/api/oms/order",
        json={"symbol": "AAPL", "side": "buy", "quantity": 1, "order_type": "limit", "limit_price": 50},
    )
    assert resp.status_code == 503
    db = SessionLocal()
    try:
        assert db.query(OmsOrderORM).count() == 0
        assert db.query(OmsFillORM).count() == 0
    finally:
        db.close()


def test_buy_limit_not_crossed_stays_open(monkeypatch):
    client, SessionLocal = _build_oms(monkeypatch, price=100.0)
    resp = client.post(
        "/api/oms/order",
        json={"symbol": "AAPL", "side": "buy", "quantity": 1, "order_type": "limit", "limit_price": 90},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["order"]["status"] == "accepted"
    assert body["fill"] is None
    db = SessionLocal()
    try:
        assert db.query(OmsFillORM).count() == 0
    finally:
        db.close()


def test_sell_limit_not_crossed_stays_open(monkeypatch):
    client, _ = _build_oms(monkeypatch, price=100.0)
    resp = client.post(
        "/api/oms/order",
        json={"symbol": "AAPL", "side": "sell", "quantity": 1, "order_type": "limit", "limit_price": 110},
    )
    assert resp.json()["order"]["status"] == "accepted"
    assert resp.json()["fill"] is None


def test_crossed_limit_fills_at_market_with_costs(monkeypatch):
    client, _ = _build_oms(monkeypatch, price=100.0)
    resp = client.post(
        "/api/oms/order",
        json={"symbol": "AAPL", "side": "buy", "quantity": 10, "order_type": "limit", "limit_price": 105},
    )
    body = resp.json()
    assert body["order"]["status"] == "filled"
    assert body["fill"]["fill_price"] == pytest.approx(100.0)
    assert body["fill"]["cost"] > 0


def test_market_order_costs_non_zero_and_single_transaction(monkeypatch):
    client, SessionLocal = _build_oms(monkeypatch, price=100.0)
    resp = client.post("/api/oms/order", json={"symbol": "AAPL", "side": "sell", "quantity": 10})
    body = resp.json()
    assert body["order"]["status"] == "filled"
    assert body["fill"]["cost"] > 0
    db = SessionLocal()
    try:
        # order created + fill created + order filled audit rows all persisted by the one commit
        assert db.query(AuditLogORM).count() == 3
        assert db.query(OmsOrderORM).one().status == "filled"
    finally:
        db.close()


def test_limit_without_price_is_422(monkeypatch):
    client, _ = _build_oms(monkeypatch)
    resp = client.post("/api/oms/order", json={"symbol": "AAPL", "side": "buy", "quantity": 1, "order_type": "limit"})
    assert resp.status_code == 422


# ---- SEC-9 ----------------------------------------------------------------

def test_viewer_and_trader_cannot_edit_restricted_list(monkeypatch):
    for role in ("viewer", "trader"):
        client, SessionLocal = _build_oms(monkeypatch, role=role)
        resp = client.post("/api/oms/restricted", json={"symbol": "RELIANCE", "reason": "x"})
        assert resp.status_code == 403
        db = SessionLocal()
        try:
            assert db.query(RestrictedListORM).count() == 0
        finally:
            db.close()


def test_admin_can_edit_restricted_list(monkeypatch):
    client, _ = _build_oms(monkeypatch, role="admin")
    resp = client.post("/api/oms/restricted", json={"symbol": "reliance", "reason": "x"})
    assert resp.status_code == 200
    assert resp.json()["symbol"] == "RELIANCE"


def test_client_sent_limits_are_ignored(monkeypatch):
    client, _ = _build_oms(monkeypatch, price=100.0)
    # 1e9 notional exceeds the server default; a client-sent huge limit must not bypass it.
    resp = client.post(
        "/api/oms/order",
        json={"symbol": "AAPL", "side": "buy", "quantity": 10_000_000, "max_position_notional": 1e15, "max_adv_pct": 1.0},
    )
    assert resp.json()["order"]["status"] == "rejected"
    assert "Max position" in resp.json()["order"]["rejection_reason"]


def test_server_limit_comes_from_env(monkeypatch):
    monkeypatch.setenv("OMS_MAX_POSITION_NOTIONAL", "1000")
    client, _ = _build_oms(monkeypatch, price=100.0)
    resp = client.post("/api/oms/order", json={"symbol": "AAPL", "side": "buy", "quantity": 20})
    assert resp.json()["order"]["status"] == "rejected"


# ---- REL-13 ---------------------------------------------------------------

@pytest.mark.skipif(not hasattr(Holding, "user_id"), reason="Holding.user_id column not present yet (W6)")
def test_risk_only_sees_own_holdings():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        from backend.models import User

        for uid in ("user-a", "user-b"):
            db.add(User(id=uid, email=f"{uid}@example.com", hashed_password="x"))
        db.flush()
        db.add(Holding(ticker="INFY", quantity=1, avg_buy_price=1, buy_date="2026-01-01", user_id="user-a"))
        db.add(Holding(ticker="TCS", quantity=1, avg_buy_price=1, buy_date="2026-01-01", user_id="user-b"))
        db.commit()
        syms = asyncio.run(risk_routes._get_target_symbols(db, None, _user("user-a")))
        assert syms == ["INFY"]
        assert asyncio.run(risk_routes._get_target_symbols(db, None, None)) == []
    finally:
        db.close()


# ---- REL-14 ---------------------------------------------------------------

def test_benchmark_failure_gives_beta_none(monkeypatch):
    rng = np.random.default_rng(1)
    dates = pd.date_range("2026-01-01", periods=120, freq="B")
    stock = pd.Series(rng.normal(0, 0.01, len(dates)), index=dates)

    async def fake_load(symbols):
        if symbols and symbols[0].startswith("^"):
            return pd.DataFrame()
        return pd.DataFrame({"RELIANCE": stock})

    async def fake_targets(db, ticker=None, user=None):
        return ["RELIANCE"]

    class _Cls:
        country_code = "IN"

    async def fake_classify(_t):
        return _Cls()

    monkeypatch.setattr(risk_routes, "_load_symbols_returns", fake_load)
    monkeypatch.setattr(risk_routes, "_get_target_symbols", fake_targets)
    monkeypatch.setattr(risk_routes.market_classifier, "classify", fake_classify)
    out = asyncio.run(risk_routes.get_risk_summary(ticker="RELIANCE", db=None, user=None))
    assert out.beta is None
    assert out.benchmark_unavailable is True
    assert out.ewma_vol > 0


# ---- SEC-10 ---------------------------------------------------------------

def test_kite_never_forwards_app_jwt(monkeypatch):
    app = FastAPI()
    app.include_router(kite_routes.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: _user(role="admin")

    sent_headers: list[dict] = []

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "success", "data": []}

    class _FakeHttp:
        async def get(self, url, params=None, headers=None):
            sent_headers.append(dict(headers or {}))
            return _Resp()

    kc = KiteClient(api_key="apikey", api_secret="s")
    kc.access_token = ""  # no operator env token for this test
    kc.client = _FakeHttp()  # type: ignore[assignment]
    monkeypatch.setattr(kite_routes, "kite", kc)
    client = TestClient(app)

    # App JWT only -> must not be used as the Kite token.
    resp = client.get("/api/kite/holdings", headers={"Authorization": "Bearer app.jwt.token"})
    assert resp.status_code == 401
    assert sent_headers == []

    resp = client.get(
        "/api/kite/holdings",
        headers={"Authorization": "Bearer app.jwt.token", "X-Kite-Access-Token": "kite-tok"},
    )
    assert resp.status_code == 200
    assert sent_headers == [{"Authorization": "token apikey:kite-tok"}]
    assert all("app.jwt.token" not in v for h in sent_headers for v in h.values())


def test_kite_holdings_and_positions_admin_only(monkeypatch):
    app = FastAPI()
    app.include_router(kite_routes.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: _user(role="trader")
    client = TestClient(app)
    for path in ("/api/kite/holdings", "/api/kite/positions"):
        assert client.get(path, headers={"X-Kite-Access-Token": "t"}).status_code == 403
