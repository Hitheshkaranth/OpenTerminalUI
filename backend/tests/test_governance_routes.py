from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.deps import get_db
from backend.api.routes.governance import router as governance_router
from backend.auth.deps import get_current_user
from backend.shared.db import Base
from backend.models import DataVersionORM, ModelExperiment, ModelRun


def _build_app() -> tuple[TestClient, sessionmaker]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(governance_router, prefix="/api")

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


def test_governance_register_compare_promote() -> None:
    client, SessionLocal = _build_app()
    db = SessionLocal()
    try:
        dv = DataVersionORM(name="v1", description="", source="test", is_active=True, metadata_json={})
        exp = ModelExperiment(
            name="exp",
            description="",
            tags=[],
            model_key="example:sma_crossover",
            params_json={},
            universe_json={},
            benchmark_symbol=None,
            start_date="2024-01-01",
            end_date="2024-12-31",
            cost_model_json={},
        )
        db.add(dv)
        db.add(exp)
        db.commit()
        db.refresh(exp)
        run = ModelRun(experiment_id=exp.id, backtest_run_id="bt1", status="done")
        db.add(run)
        db.commit()
        db.refresh(run)
        run_id = run.id
        dv_id = dv.id
    finally:
        db.close()

    reg = client.post("/api/governance/runs/register", json={"run_id": run_id, "data_version_id": dv_id, "code_hash": "abc123", "execution_profile": {"slippage_bps": 3}})
    assert reg.status_code == 200
    cmp = client.get(f"/api/governance/runs/compare?run_ids={run_id}")
    assert cmp.status_code == 200
    assert len(cmp.json()["items"]) == 1
    promote = client.post("/api/governance/model-registry/promote", json={"registry_name": "main-model", "run_id": run_id, "stage": "staging"})
    assert promote.status_code == 200
