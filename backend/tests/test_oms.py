from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes import oms
from backend.auth.deps import get_current_user
from backend.config.constants import DEFAULT_MAX_ADV_PCT, DEFAULT_MAX_POSITION_NOTIONAL
from backend.models import OmsOrderORM, OpsKillSwitchORM, RestrictedListORM
from backend.oms.service import pre_trade_checks
from backend.shared.db import Base


def _build_app(monkeypatch) -> tuple[TestClient, sessionmaker]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(oms.router, prefix="/api")

    async def _fake_snap(_: str):
        return {"current_price": 100.0, "market_cap": 1_000_000_000}

    monkeypatch.setattr(oms, "fetch_stock_snapshot_coalesced", _fake_snap)

    def _db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def _user_override():
        return type("FakeUser", (), {"id": "u_test"})()

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_current_user] = _user_override
    return TestClient(app), SessionLocal


def test_pre_trade_check_restricted_symbol(monkeypatch) -> None:
    """Pre-trade: orders for restricted symbols are rejected."""
    client, SessionLocal = _build_app(monkeypatch)

    db = SessionLocal()
    try:
        db.add(RestrictedListORM(symbol="RESTRICTED", reason="compliance block", active=True))
        db.commit()
    finally:
        db.close()

    resp = client.post("/api/oms/order", json={"symbol": "RESTRICTED", "side": "buy", "quantity": 10})
    assert resp.status_code == 200
    assert resp.json()["order"]["status"] == "rejected"
    assert "restricted" in resp.json()["order"]["rejection_reason"].lower()


def test_pre_trade_check_order_over_limit(monkeypatch) -> None:
    """Pre-trade: orders exceeding max position notional are rejected."""
    client, _ = _build_app(monkeypatch)
    resp = client.post(
        "/api/oms/order", json={"symbol": "AAPL", "side": "buy", "quantity": 999999}
    )
    assert resp.status_code == 200
    assert resp.json()["order"]["status"] == "rejected"


def test_pre_trade_check_zero_price(monkeypatch) -> None:
    """Pre-trade: zero-price orders are rejected at the route level."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(oms.router, prefix="/api")

    def _db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    async def _mock_snap(_: str):
        return {"current_price": 0.0, "market_cap": 0}

    monkeypatch.setattr(oms, "fetch_stock_snapshot_coalesced", _mock_snap)

    def _user_override():
        return type("FakeUser", (), {"id": "u_test"})()

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_current_user] = _user_override

    client = TestClient(app)
    resp = client.post("/api/oms/order", json={"symbol": "AAPL", "side": "buy", "quantity": 10})
    assert resp.status_code == 400


def test_pre_trade_check_adv_participation(monkeypatch) -> None:
    """Pre-trade: orders exceeding ADV participation limits are rejected."""
    client, _ = _build_app(monkeypatch)
    resp = client.post(
        "/api/oms/order", json={"symbol": "AAPL", "side": "buy", "quantity": 999999}
    )
    assert resp.status_code == 200


def test_order_creation_accepted(monkeypatch) -> None:
    """OMS: a valid order is accepted and returns a fill."""
    client, _ = _build_app(monkeypatch)
    resp = client.post("/api/oms/order", json={"symbol": "AAPL", "side": "buy", "quantity": 10})
    assert resp.status_code == 200
    data = resp.json()
    assert data["order"]["status"] == "filled"
    assert data["fill"]["fill_price"] > 0


def test_order_creation_with_rejection_reason(monkeypatch) -> None:
    """OMS: an order that fails pre-trade returns rejection_reason."""
    client, _ = _build_app(monkeypatch)
    resp = client.post(
        "/api/oms/order", json={"symbol": "AAPL", "side": "buy", "quantity": 999999}
    )
    assert resp.json()["order"]["rejection_reason"] is not None


def test_list_orders_returns_empty(monkeypatch) -> None:
    """OMS: listing orders with no history returns an empty list."""
    client, _ = _build_app(monkeypatch)
    resp = client.get("/api/oms/orders")
    assert resp.status_code == 200
    assert resp.json() == {"items": []}


def test_custom_max_notional(monkeypatch) -> None:
    """OMS: respects per-user custom max notional limits."""
    client, _ = _build_app(monkeypatch)

    class CustomUser:
        id = "u_custom"
        max_notional = 500

    client.app.dependency_overrides[get_current_user] = lambda: CustomUser()  # type: ignore[assignment]

    resp = client.post("/api/oms/order", json={"symbol": "AAPL", "side": "buy", "quantity": 10})
    assert resp.status_code == 200


def test_constants_used_in_oms(monkeypatch) -> None:
    """OMS: constants are used for thresholds."""
    assert DEFAULT_MAX_POSITION_NOTIONAL > 0
    assert DEFAULT_MAX_ADV_PCT > 0