from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes import oms, ops
from backend.auth.deps import get_current_user
from backend.db.database import Base


def _build_app(monkeypatch) -> TestClient:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(oms.router, prefix="/api")
    app.include_router(ops.router, prefix="/api")

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
    return TestClient(app)


def test_oms_restricted_and_kill_switch(monkeypatch) -> None:
    client = _build_app(monkeypatch)

    rest = client.post("/api/oms/restricted", json={"symbol": "RELIANCE", "reason": "test block", "active": True})
    assert rest.status_code == 200

    blocked = client.post("/api/oms/order", json={"symbol": "RELIANCE", "side": "buy", "quantity": 10})
    assert blocked.status_code == 200
    assert blocked.json()["order"]["status"] == "rejected"

    ks = client.post("/api/ops/kill-switch", json={"scope": "orders", "enabled": True, "reason": "maintenance"})
    assert ks.status_code == 200

    blocked2 = client.post("/api/oms/order", json={"symbol": "INFY", "side": "buy", "quantity": 10})
    assert blocked2.status_code == 200
    assert blocked2.json()["order"]["status"] == "rejected"
