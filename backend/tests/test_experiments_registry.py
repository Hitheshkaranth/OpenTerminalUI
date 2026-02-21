import os
os.environ["AUTH_MIDDLEWARE_ENABLED"] = "0"

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


def test_experiments_registry_flow(client):
    # 1. Create 2 experiments
    r1 = client.post("/api/experiments", json={"name": "Exp 1", "config": {"momentum": 10}})
    assert r1.status_code == 200
    e1 = r1.json()
    assert e1["id"] == 1
    assert e1["data_hash"] is not None
    assert e1["code_hash"] is not None

    r2 = client.post("/api/experiments", json={"name": "Exp 2", "config": {"momentum": 20}})
    assert r2.status_code == 200
    e2 = r2.json()
    assert e2["id"] == 2

    # 2. List experiments
    r_list = client.get("/api/experiments")
    assert r_list.status_code == 200
    exps = r_list.json()
    assert len(exps) == 2

    # 3. Read specific experiment
    r_single = client.get("/api/experiments/1")
    assert r_single.status_code == 200
    assert r_single.json()["name"] == "Exp 1"

    # 4. Compare
    r_comp = client.post("/api/experiments/compare", json={"experiment_ids": [1, 2]})
    assert r_comp.status_code == 200
    comp_json = r_comp.json()
    assert "metrics_table" in comp_json
    assert "deltas" in comp_json
    assert "exp_1" in comp_json["metrics_table"]
    assert "exp_2" in comp_json["metrics_table"]

    # 5. Promote to paper
    r_promo = client.post("/api/experiments/1/promote-to-paper")
    assert r_promo.status_code == 200
    assert "receipt_id" in r_promo.json()
    assert r_promo.json()["status"] == "promoted"
