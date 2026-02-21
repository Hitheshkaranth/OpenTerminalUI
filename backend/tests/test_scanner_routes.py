from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db, get_unified_fetcher
from backend.auth.deps import get_current_user
from backend.db.database import Base
from backend.screener.routes import router as screener_router


def _chart_payload(days: int = 280) -> dict:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    ts = [int((start + timedelta(days=i)).timestamp()) for i in range(days)]
    close = [100 + i * 0.5 for i in range(days)]
    return {
        "chart": {
            "result": [
                {
                    "timestamp": ts,
                    "indicators": {
                        "quote": [
                            {
                                "open": [c - 0.2 for c in close],
                                "high": [c + 0.4 for c in close],
                                "low": [c - 0.6 for c in close],
                                "close": close,
                                "volume": [1_500_000 + i * 1000 for i in range(days)],
                            }
                        ]
                    },
                }
            ]
        }
    }


class _FakeFetcher:
    async def fetch_history(self, ticker: str, range_str: str = "1y", interval: str = "1d"):  # noqa: ARG002
        return _chart_payload()


def _build_app() -> TestClient:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(screener_router, prefix="/api")

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
    return TestClient(app)


def test_scanner_preset_crud_and_run() -> None:
    client = _build_app()
    payload = {
        "name": "Test Breakout",
        "universe": "NSE:NIFTY50",
        "timeframe": "1d",
        "liquidity_gate": {"min_price": 10, "min_avg_volume": 0, "min_avg_traded_value": 0},
        "rules": [{"type": "breakout_n_day_high", "params": {"n": 20, "buffer_pct": 0.001, "rvol_threshold": 0.1, "near_trigger_pct": 0.01}}],
        "ranking": {"mode": "default", "params": {}},
    }

    created = client.post("/api/v1/screener/presets", json=payload)
    assert created.status_code == 200
    preset_id = created.json()["id"]

    listed = client.get("/api/v1/screener/presets")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) >= 1

    run = client.post("/api/v1/screener/run", json={"preset_id": preset_id, "limit": 20, "offset": 0})
    assert run.status_code == 200
    run_id = run.json()["run_id"]

    runs = client.get("/api/v1/screener/runs?limit=5&offset=0")
    assert runs.status_code == 200
    assert len(runs.json()["items"]) >= 1

    results = client.get(f"/api/v1/screener/results?run_id={run_id}&limit=10&offset=0")
    assert results.status_code == 200
    assert isinstance(results.json()["items"], list)

    rule_create = client.post(
        "/api/v1/alerts/scanner-rules",
        json={
            "preset_id": preset_id,
            "symbol": "RELIANCE",
            "setup_type": "20D_BREAKOUT",
            "trigger_level": 2500,
            "near_trigger_pct": 0.003,
            "dedupe_minutes": 15,
            "enabled": True,
        },
    )
    assert rule_create.status_code == 200
    rule_list = client.get("/api/v1/alerts/scanner-rules")
    assert rule_list.status_code == 200
    assert len(rule_list.json()["items"]) == 1
