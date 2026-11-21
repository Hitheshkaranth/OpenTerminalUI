"""Legacy configuration storage must not claim simulated or deployed results."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from types import SimpleNamespace

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.experiments import service
from backend.experiments.models import Experiment
from backend.experiments.routes import router


@pytest.fixture
def registry():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Experiment.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    app = FastAPI()
    app.include_router(router, prefix="/api")

    def database():
        yield session

    app.dependency_overrides[get_db] = database
    # Legacy rows predate ownership (owner_id NULL); only admins can reach them.
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="admin-1", role="admin")
    with TestClient(app) as client:
        yield client, session
    session.close()
    engine.dispose()


def test_new_configuration_has_no_performance_or_dataset_provenance(registry):
    client, session = registry
    config = {"symbol": "AAPL", "lookback": 20}
    response = client.post("/api/experiments", json={"name": "Unrun idea", "config": config})
    assert response.status_code == 200
    saved = response.json()
    assert saved["config_json"] == config
    assert saved["metrics_json"] == {}
    assert saved["data_hash"] is None
    assert {"unexecuted", "execution_engine_unavailable"} <= set(saved["tags"])
    assert session.get(Experiment, saved["id"]).metrics_json == {}
    assert client.get(f"/api/experiments/{saved['id']}").json() == saved
    assert client.get("/api/experiments").json() == [saved]


def test_unrun_comparison_does_not_invent_metrics_or_deltas(registry):
    client, _ = registry
    ids = [
        client.post("/api/experiments", json={"name": name, "config": {}}).json()["id"]
        for name in ["First idea", "Second idea"]
    ]
    response = client.post("/api/experiments/compare", json={"experiment_ids": ids})
    assert response.status_code == 200
    assert response.json() == {
        "metrics_table": {f"exp_{key}": {} for key in ids}, "deltas": {}
    }


def test_promotion_is_explicitly_unavailable_and_does_not_change_configuration(registry):
    client, session = registry
    saved = client.post("/api/experiments", json={"name": "Idea", "config": {}}).json()
    response = client.post(f"/api/experiments/{saved['id']}/promote-to-paper")
    assert response.status_code == 501
    assert "no paper strategy was created" in response.json()["detail"]
    assert "receipt_id" not in response.json()
    assert client.get(f"/api/experiments/{saved['id']}").json() == saved
    with pytest.raises(NotImplementedError):
        service.promote_experiment_to_paper(session, saved["id"])


def test_missing_experiment_remains_not_found(registry):
    client, session = registry
    assert client.get("/api/experiments/999").status_code == 404
    response = client.post("/api/experiments/999/promote-to-paper")
    assert response.status_code == 404
    assert response.json()["detail"] == "Experiment not found"
    with pytest.raises(ValueError, match="Experiment not found"):
        service.promote_experiment_to_paper(session, 999)


def test_preexisting_records_are_preserved_but_cannot_be_promoted(registry):
    client, session = registry
    # Historical rows are not silently rewritten; their prior metrics remain
    # unverified until a separate, explicit data remediation is performed.
    old = Experiment(name="Historical scaffold", config_json={"old": True},
                     data_hash="legacy-config-hash", metrics_json={"sharpe": 1.2}, tags=[])
    session.add(old)
    session.commit()
    response = client.get(f"/api/experiments/{old.id}")
    assert response.status_code == 200
    assert response.json()["metrics_json"] == {"sharpe": 1.2}
    assert response.json()["data_hash"] == "legacy-config-hash"
    assert client.post(f"/api/experiments/{old.id}/promote-to-paper").status_code == 501
    session.refresh(old)
    assert old.metrics_json == {"sharpe": 1.2}
