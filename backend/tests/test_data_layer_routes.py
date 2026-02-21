from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db, get_unified_fetcher
from backend.api.routes.data_layer import router as data_layer_router
from backend.auth.deps import get_current_user
from backend.db.database import Base
from backend.models import CorpActionORM, DataVersionORM


def _chart_payload(days: int = 8) -> dict:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    ts = [int((start + timedelta(days=i)).timestamp()) for i in range(days)]
    close = [100.0 for _ in range(days)]
    return {
        "chart": {
            "result": [
                {
                    "timestamp": ts,
                    "indicators": {
                        "quote": [
                            {
                                "open": close,
                                "high": close,
                                "low": close,
                                "close": close,
                                "volume": [1000000 for _ in range(days)],
                            }
                        ]
                    },
                }
            ]
        }
    }


class _FakeFetcher:
    async def fetch_history(self, ticker: str, range_str: str = "5y", interval: str = "1d"):  # noqa: ARG002
        return _chart_payload()


def _build_app() -> tuple[TestClient, sessionmaker]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(data_layer_router, prefix="/api")

    def _db_override():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    async def _fetcher_override():
        return _FakeFetcher()

    def _user_override():
        return type("FakeUser", (), {"id": "u_test"})()

    app.dependency_overrides[get_db] = _db_override
    app.dependency_overrides[get_unified_fetcher] = _fetcher_override
    app.dependency_overrides[get_current_user] = _user_override
    return TestClient(app), SessionLocal


def test_data_version_and_adjusted_prices() -> None:
    client, SessionLocal = _build_app()
    create_res = client.post("/api/data/version", json={"name": "pit-v1", "description": "test"})
    assert create_res.status_code == 200
    version_id = create_res.json()["id"]

    db = SessionLocal()
    try:
        db.add(
            CorpActionORM(
                symbol="RELIANCE",
                action_date="2025-01-05",
                action_type="split",
                factor=2.0,
                amount=None,
                notes="2-for-1",
                data_version_id=version_id,
                created_at=datetime.utcnow(),
            )
        )
        db.commit()
    finally:
        db.close()

    raw_res = client.get(f"/api/prices/RELIANCE?adjusted=false&data_version_id={version_id}")
    adj_res = client.get(f"/api/prices/RELIANCE?adjusted=true&data_version_id={version_id}")
    assert raw_res.status_code == 200
    assert adj_res.status_code == 200
    raw_first = raw_res.json()["items"][0]["close"]
    adj_first = adj_res.json()["items"][0]["close"]
    assert raw_first == 100.0
    assert adj_first == 50.0
