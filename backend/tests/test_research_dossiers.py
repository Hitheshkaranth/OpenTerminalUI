from __future__ import annotations

from types import SimpleNamespace
from datetime import datetime, timezone, timedelta
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.shared.db import Base
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.research_dossiers.routes import router
from backend.research_dossiers.models import ResearchDossier
from backend.research_dossiers.service import digest
from backend.models.notification import Notification
from backend.models.agent_memory import AgentRun


@pytest.fixture
def api():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    app = FastAPI()
    app.include_router(router)
    state = {"user": "owner"}
    def db():
        with Session() as session:
            yield session
    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=state["user"])
    with TestClient(app) as client:
        yield client, state, Session
    engine.dispose()


URL = "/api/research/dossiers"


def make(client, **kwargs):
    r = client.post(URL, json={"title": "Margin thesis", "symbol": "TCS", "thesis": "Margins improve", **kwargs})
    assert r.status_code == 201, r.text
    return r.json()


def test_crud_revisions_conflicts_and_ownership(api):
    client, state, _ = api
    row = make(client)
    path = f"{URL}/{row['id']}"
    r = client.patch(path, json={"expected_revision": 1, "thesis": "Margins recover with utilization"})
    assert r.status_code == 200
    assert r.json()["revision"] == 2
    assert client.patch(path, json={"expected_revision": 1, "thesis": "stale edit"}).status_code == 409
    revisions = client.get(path + "/revisions").json()["items"]
    assert revisions[0]["snapshot"]["thesis"] == "Margins recover with utilization"
    assert revisions[1]["snapshot"]["thesis"] == "Margins improve"
    state["user"] = "intruder"
    assert client.get(URL).json() == {"items": []}
    for method, suffix in (("get", ""), ("get", "/export"), ("get", "/revisions"), ("post", "/share"), ("post", "/monitor"), ("delete", "")):
        assert getattr(client, method)(path + suffix).status_code == 404
    state["user"] = "owner"
    assert client.delete(path).status_code == 200
    assert client.get(path).status_code == 404


def test_validation_and_cross_user_links(api):
    client, _, Session = api
    with Session() as db:
        db.add(AgentRun(id="secret", user_id="other", mode="standard", prompt="private", status="done"))
        db.commit()
    assert client.post(URL, json={"title": " ", "symbol": "TCS"}).status_code == 422
    assert client.post(URL, json={"title": "x", "symbol": "TCS", "linked_run_ids": ["secret"]}).status_code == 422
    row = make(client)
    assert client.patch(f"{URL}/{row['id']}", json={"materiality_threshold": -1}).status_code == 422
    assert client.patch(f"{URL}/{row['id']}", json={"title": None}).status_code == 422
    assert client.post(URL, json={"title": "x", "symbol": "TCS", "evidence": [{"claim": "x", "source_url": "javascript:alert(1)"}]}).status_code == 422


def test_monitor_deduplicates_and_preserves_curated_thesis(api):
    client, _, Session = api
    initial = {"id": "margin", "claim": "Margin", "metric": "operating_margin", "value": 20, "unit": "%", "stance": "supporting"}
    row = make(client, evidence=[initial], materiality_threshold=5)
    path = f"{URL}/{row['id']}"
    small = {**initial, "value": 20.2}
    result = client.post(path + "/monitor", json={"evidence": [small]}).json()
    assert result["changes"][0]["material"] is False
    large = {**initial, "value": 15, "stance": "opposing"}
    result = client.post(path + "/monitor", json={"evidence": [large]}).json()
    assert result["changes"][0]["material"] is True
    assert result["dossier"]["evidence"][0]["value"] == 20
    repeat = client.post(path + "/monitor", json={"evidence": [{**large, "observed_at": "2026-10-25T12:00:00Z"}]}).json()
    assert repeat["changes"] == []
    with Session() as db:
        assert db.query(Notification).count() == 1


def test_share_is_frozen_sanitized_and_revocable(api):
    client, state, Session = api
    with Session() as db:
        db.add(AgentRun(id="run", user_id="owner", mode="standard", prompt="private", status="done"))
        db.commit()
    row = make(client, linked_run_ids=["run"])
    path = f"{URL}/{row['id']}"
    shared = client.post(path + "/share").json()
    client.patch(path, json={"thesis": "new private thought"})
    state["user"] = "other"
    snap = client.get(shared["url"]).json()
    assert snap["read_only"] is True
    assert snap["dossier"]["thesis"] == "Margins improve"
    assert "linked_run_ids" not in snap["dossier"]
    assert "portfolio_id" not in snap["dossier"]
    assert client.patch(shared["url"], json={"thesis": "attack"}).status_code == 405
    state["user"] = "owner"
    client.delete(path + "/share")
    assert client.get(shared["url"]).status_code == 404


def test_export_captures_owned_run_and_has_verifiable_digest(api, monkeypatch):
    from backend.agent import execution
    from backend.models.agent_memory import AgentRunExecution, AgentRunEvent
    client, _, Session = api
    monkeypatch.setattr(execution, "SessionLocal", Session)
    with Session() as db:
        db.add(AgentRun(id="run", user_id="owner", mode="standard", prompt="Compare", final="answer", status="done", grounding_json=json.dumps({"sources": ["frozen"]})))
        db.add(AgentRunExecution(run_id="run", user_id="owner", spec_json=json.dumps({"prompt": "Compare", "model": "fixture"}), state="done"))
        db.add(AgentRunEvent(run_id="run", payload_json=json.dumps({"type": "tool_result", "result": {"price": 100}})))
        db.commit()
    row = make(client, linked_run_ids=["run"])
    snapshot = client.get(f"{URL}/{row['id']}/export").json()
    sha = snapshot.pop("sha256")
    assert sha == digest(snapshot)
    assert snapshot["runs"][0]["grounding"] == {"sources": ["frozen"]}
    assert snapshot["schema_version"] == 1
    assert snapshot["runs"][0]["runtime"]["request"]["model"] == "fixture"
    assert snapshot["runs"][0]["runtime"]["events"][0]["event"]["result"] == {"price": 100}


def test_local_filing_monitor_only_new_relevant_documents(api):
    from backend.filings_rag.store import add_document
    from backend.filings_rag.models import FilingDocumentORM
    client, _, Session = api
    row = make(client, market="IN", monitoring_enabled=True)
    path = f"{URL}/{row['id']}"
    with Session() as db:
        doc = add_document(db, symbol="TCS", market="IN", doc_type="annual_report", title="Results", period="2026", source="upload", source_url=None,
                          filed_at="2026-10-25", pages=["Operating margins improve as utilization increases. Revenue grew 12 percent and margin expanded 20 basis points."])
        db.query(FilingDocumentORM).filter_by(id=doc["id"]).update({"created_at": datetime.now(timezone.utc) + timedelta(seconds=1)})
        db.commit()
    first = client.post(path + "/monitor", json={}).json()
    assert len(first["changes"]) == 1
    evidence = first["changes"][0]["after"]
    assert evidence["stance"] == "neutral"
    assert "no contradiction is inferred" in evidence["claim"]
    assert client.post(path + "/monitor", json={}).json()["changes"] == []
    passage = client.get(path + "/search", params={"q": "margin", "as_of": "2026-10-24"}).json()
    assert passage["items"] == []
    assert client.get(path + "/search", params={"q": "margin", "as_of": "not-a-date"}).status_code == 422


def test_shared_snapshot_through_production_auth_middleware(monkeypatch):
    from backend.auth.middleware import AuthMiddleware
    from backend.auth.csrf import CsrfProtectMiddleware
    from backend.auth.deps import auth_exempt_path
    from backend.research_dossiers.service import create, share
    from backend.research_dossiers.schemas import DossierCreate
    monkeypatch.setenv("OPENTERMINALUI_ENV", "production")
    monkeypatch.setenv("AUTH_MIDDLEWARE_ENABLED", "0")  # production ignores this escape hatch
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        row = create(db, "owner", DossierCreate(title="Private thesis", symbol="TCS"))
        shared = share(db, db.get(ResearchDossier, row["id"]))
    app = FastAPI()
    app.include_router(router)
    app.add_middleware(AuthMiddleware)
    app.add_middleware(CsrfProtectMiddleware)
    app.state.db_session_factory = factory
    def get_session():
        with factory() as session:
            yield session
    app.dependency_overrides[get_db] = get_session
    with TestClient(app) as client:
        assert client.get(shared["url"]).status_code == 200
        assert client.get(URL).status_code == 401
        assert client.get(f"{URL}/{row['id']}").status_code == 401
        assert client.get(shared["url"] + "/export").status_code == 401
        assert client.get(URL + "/shared/" + "x" * 43).status_code == 404
        assert client.get(URL + "/shared/short").status_code == 401
        assert client.patch(shared["url"], json={"thesis": "changed"}).status_code in (403, 405)
    assert not auth_exempt_path(URL + "/shared")
    assert not auth_exempt_path(shared["url"] + "/revisions")
    engine.dispose()
