from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.shared.db import Base
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.research_dossiers.experiments import router
from backend.research_dossiers.models import ResearchExperiment


@pytest.fixture
def api():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    state = {"id": "owner"}
    app = FastAPI()
    app.include_router(router)
    def db():
        with factory() as session:
            yield session
    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=state["id"])
    with TestClient(app) as client:
        yield client, state, factory


def request():
    bars = []
    for i in range(40):
        dt = (datetime(2025, 1, 1, 16, tzinfo=timezone.utc) + timedelta(days=i)).isoformat()
        price = 100 + (i % 9) * 3 - (i % 5)
        bars.append({"date": dt, "available_at": dt, "open": price, "high": price + 2,
                     "low": price - 2, "close": price + 1, "volume": 1000})
    return {"title": "Frozen SMA", "symbol": "TCS", "provider": "fixture", "data_version": "fixture-v1",
            "adjustment_policy": "raw", "as_of": "2025-03-01T00:00:00Z", "train_end": bars[24]["date"],
            "validation_start": bars[25]["date"], "short_window": 2, "long_window": 4,
            "fee_bps": 10, "slippage_bps": 5, "bars": bars}


URL = "/api/research/experiments"


def test_frozen_replay_and_costs_and_ownership(api):
    client, state, _ = api
    r = client.post(URL, json=request())
    assert r.status_code == 201, r.text
    snapshot = r.json()
    assert snapshot["config"]["fee_bps"] == 10
    assert snapshot["config"]["slippage_bps"] == 5
    assert snapshot["validation_policy"]["fill_delay_bars"] == 1
    assert snapshot["results"]["training"]["bars"] == 25
    assert snapshot["results"]["validation"]["bars"] == 15
    replay = client.post(f"{URL}/{snapshot['id']}/replay")
    assert replay.status_code == 200, replay.text
    assert replay.json()["matches"] is True
    assert replay.json()["provider_requests"] == 0
    free = request()
    free["fee_bps"] = free["slippage_bps"] = 0
    free_result = client.post(URL, json=free).json()
    assert free_result["results"]["training"]["final_equity"] > snapshot["results"]["training"]["final_equity"]
    state["id"] = "intruder"
    assert client.get(URL).json()["items"] == []
    assert client.get(f"{URL}/{snapshot['id']}").status_code == 404
    assert client.post(f"{URL}/{snapshot['id']}/replay").status_code == 404


@pytest.mark.parametrize("mutation", ["missing_publication", "future", "overlap", "duplicate", "late_publication", "unknown_source", "missing_timezone"])
def test_rejects_unknown_and_lookahead_data(api, mutation):
    client, _, _ = api
    payload = request()
    if mutation == "missing_publication":
        del payload["bars"][0]["available_at"]
    elif mutation == "future":
        payload["as_of"] = "2025-01-05T00:00:00Z"
    elif mutation == "overlap":
        payload["validation_start"] = payload["train_end"]
    elif mutation == "duplicate":
        payload["bars"][1] = payload["bars"][0]
    elif mutation == "late_publication":
        payload["bars"][0]["available_at"] = "2025-03-01T00:00:00Z"
    elif mutation == "unknown_source":
        payload["provider"] = "unknown"
    elif mutation == "missing_timezone":
        payload["bars"][0]["available_at"] = "2025-01-01T16:00:00"
    assert client.post(URL, json=payload).status_code == 422


def test_replay_rejects_tampered_input(api):
    client, _, factory = api
    snapshot = client.post(URL, json=request()).json()
    with factory() as db:
        row = db.get(ResearchExperiment, snapshot["id"])
        row.snapshot = {**row.snapshot, "data_sha256": "tampered"}
        db.commit()
    assert client.post(f"{URL}/{snapshot['id']}/replay").status_code == 409


def test_replay_refuses_changed_engine_identity(api, monkeypatch):
    from backend.research_dossiers import experiments
    client, _, _ = api
    snapshot = client.post(URL, json=request()).json()
    monkeypatch.setattr(experiments, "engine_identity", lambda: {"code_sha256": "new-version"})
    response = client.post(f"{URL}/{snapshot['id']}/replay")
    assert response.status_code == 409
    assert "versions changed" in response.json()["detail"]
