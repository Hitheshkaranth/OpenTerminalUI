import os
os.environ["AUTH_MIDDLEWARE_ENABLED"] = "0"

import time
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.db.database import Base
from backend.api.deps import get_db

_engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
Base.metadata.create_all(bind=_engine)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
_db = _Session()


def _override_get_db():
    try:
        yield _db
    finally:
        pass


@pytest.fixture(scope="module")
def client():
    app.dependency_overrides[get_db] = _override_get_db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def test_portfolio_backtest_job_flow(client):
    # 1. Create Job
    payload = {
        "strategy_id": "test_strat",
        "start_date": "2023-01-01",
        "end_date": "2023-12-31",
        "universe": ["AAPL", "MSFT"],
        "params": {"seed": 42}
    }

    resp_create = client.post("/api/portfolio-backtests/jobs", json=payload)
    assert resp_create.status_code == 200
    data_create = resp_create.json()
    assert "job_id" in data_create
    assert data_create["status"] == "queued"
    job_id = data_create["job_id"]

    # 2. Status progression
    resp_status = client.get(f"/api/portfolio-backtests/jobs/{job_id}/status")
    assert resp_status.status_code == 200
    data_status = resp_status.json()
    assert data_status["status"] in ("queued", "running", "completed")

    # BackgroundTasks in Starlette TestClient run after response returns
    time.sleep(0.5)

    # 3. Check until completed
    resp_status_final = client.get(f"/api/portfolio-backtests/jobs/{job_id}/status")
    assert resp_status_final.json()["status"] == "completed"

    # 4. Get Result
    resp_result = client.get(f"/api/portfolio-backtests/jobs/{job_id}/result")
    assert resp_result.status_code == 200
    data_result = resp_result.json()

    assert "equity_curve" in data_result
    assert "drawdown" in data_result
    assert "turnover_series" in data_result
    assert "metrics" in data_result
    assert len(data_result["equity_curve"]) > 0
