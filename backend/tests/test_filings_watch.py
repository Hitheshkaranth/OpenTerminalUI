from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.filings_watch import scheduler, service
from backend.filings_watch.models import FilingsWatchEventORM, FilingsWatchSettingsORM
from backend.filings_rag.models import FilingAnalysisORM
from backend.models.notification import Notification
from backend.models.user import User, UserRole
from backend.main import app
from backend.shared.db import Base, engine, init_db


def _session():
    local_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=local_engine)
    return sessionmaker(bind=local_engine, autoflush=True)()


def _seed_user(db):
    db.add(User(id="u1", email="u1@example.com", hashed_password="", role=UserRole.ADMIN))
    db.commit()


def _seed_settings(db, *, user_id="u1", enabled=True, **overrides):
    from backend.filings_watch.service import normalise_settings

    base = normalise_settings({"enabled": enabled, "symbols_source": "watchlists"})
    base.update(overrides)
    db.add(FilingsWatchSettingsORM(user_id=user_id, settings=base))
    db.commit()


# --------------------------------------------------------------------------- #
# run_once
# --------------------------------------------------------------------------- #
def test_run_once_stores_and_emits_new_document(monkeypatch) -> None:
    async def fake_load(db, symbol, sources, limit):
        return [
            {
                "title": "Annual Report FY24",
                "doc_type": "annual_report",
                "period": "FY24",
                "market": "NSE",
                "source": "nse",
                "pages": ["The company reported strong order wins this year."],
            }
        ]

    def fake_add(db, *, symbol, **kwargs):
        return {"id": 1, "title": kwargs.get("title"), "doc_type": kwargs.get("doc_type"), "period": kwargs.get("period")}

    async def fake_analyze(db, symbol, **kwargs):
        return None

    monkeypatch.setattr(service, "_load_import_candidates", fake_load)
    monkeypatch.setattr("backend.filings_rag.store.add_document", fake_add)
    monkeypatch.setattr(service, "_safe_analyze", fake_analyze)

    db = _session()
    _seed_settings(db, enabled=True, symbols_source="custom", custom_symbols=["TATA"])

    events = asyncio.run(service.run_once(db))

    assert len(events) == 1
    event = events[0]
    assert event["kind"] == "new_document"
    assert event["symbol"] == "TATA"
    assert "Annual Report FY24" in event["title"]
    assert event["action_url"] == "/equity/security/TATA?tab=filings"

    assert db.query(FilingsWatchEventORM).count() == 1
    notifications = db.query(Notification).filter(Notification.type == "filings").all()
    assert len(notifications) == 1
    assert notifications[0].ticker == "TATA"
    assert notifications[0].action_url == "/equity/security/TATA?tab=filings"
    assert notifications[0].priority == "medium"  # new_document is not high priority


def test_run_once_emits_stance_change_and_adverse_regulatory(monkeypatch) -> None:
    async def fake_import(db, symbol, sources, limit):
        return [{"title": "10-K", "doc_type": "annual_report", "period": "FY25"}]

    new_analysis = {
        "symbol": "TATA",
        "stance": "cautious",
        "scores": {"growth": 20.0, "headwind": 45.0, "net": -25.0},
        "headwinds": [
            {
                "id": "adverse_regulatory",
                "label": "Adverse regulatory action",
                "kind": "headwind",
                "summary": "Form 483 issued",
                "findings": [{"claim": "Form 483 observations noted", "confidence": 0.9}],
            }
        ],
    }

    async def fake_analyze(db, symbol, **kwargs):
        return new_analysis

    monkeypatch.setattr(service, "_import_symbol", fake_import)
    monkeypatch.setattr(service, "_safe_analyze", fake_analyze)

    db = _session()
    _seed_user(db)
    _seed_settings(db, enabled=True, symbols_source="custom", custom_symbols=["TATA"])

    from datetime import datetime, timezone

    db.add(FilingAnalysisORM(symbol="TATA", engine="lexical", payload={"stance": "constructive", "headwinds": []}, created_at=datetime(2024, 1, 1, tzinfo=timezone.utc)))
    db.commit()

    events = asyncio.run(service.run_once(db))

    kinds = [e["kind"] for e in events]
    assert kinds.count("new_document") == 1
    assert kinds.count("stance_change") == 1
    assert kinds.count("adverse_regulatory") == 1

    stance = next(e for e in events if e["kind"] == "stance_change")
    assert "constructive" in stance["title"] and "cautious" in stance["title"]
    adverse = next(e for e in events if e["kind"] == "adverse_regulatory")
    assert "TATA" in adverse["symbol"]
    assert db.query(Notification).filter(Notification.ticker == "TATA", Notification.priority == "high").count() == 1


def test_run_once_emits_guidance_cut_from_knowledge(monkeypatch) -> None:
    async def fake_import(db, symbol, sources, limit):
        return [{"title": "Concall", "doc_type": "concall_transcript", "period": "Q2"}]

    async def fake_analyze(db, symbol, **kwargs):
        return {"symbol": "TATA", "stance": "constructive", "headwinds": []}

    knowledge_lowered = {
        "symbol": "TATA",
        "guidance": [
            {"metric": "ROCE", "statement": "Management guided ROCE to 22%", "target": "22%", "status": "lowered"},
            {"metric": "Revenue", "statement": "Revenue guidance 10%", "target": "10%", "status": "reiterated"},
        ],
    }

    async def no_rebuild(db, symbol, **kwargs):  # the knowledge snapshots below are the fixture
        return None

    monkeypatch.setattr(service, "_import_symbol", fake_import)
    monkeypatch.setattr(service, "_safe_analyze", fake_analyze)
    import backend.filings_rag.knowledge as kn

    monkeypatch.setattr(kn, "build_knowledge", no_rebuild)

    db = _session()
    _seed_settings(db, enabled=True, symbols_source="custom", custom_symbols=["TATA"], notify_on=["new_document", "guidance_cut"])
    from datetime import datetime, timezone

    from backend.filings_rag.models import FilingKnowledgeORM

    # QC: real rows, so the (current, previous) lookup is exercised — it used to crash with two snapshots.
    knowledge_before = {"symbol": "TATA", "guidance": [{"metric": "ROCE", "statement": "ROCE 25%", "target": "25%", "status": "reiterated"}]}
    db.add(FilingKnowledgeORM(symbol="TATA", engine="lexical", payload=knowledge_before, created_at=datetime(2024, 1, 1, tzinfo=timezone.utc)))
    db.add(FilingKnowledgeORM(symbol="TATA", engine="lexical", payload=knowledge_lowered, created_at=datetime(2024, 4, 1, tzinfo=timezone.utc)))
    db.commit()

    events = asyncio.run(service.run_once(db))

    kinds = [e["kind"] for e in events]
    assert kinds.count("new_document") == 1
    assert kinds.count("guidance_cut") == 1
    guidance = next(e for e in events if e["kind"] == "guidance_cut")
    assert "ROCE" in guidance["title"]


def test_run_once_returns_empty_when_disabled(monkeypatch) -> None:
    monkeypatch.setenv("FILINGS_WATCH_ENABLED", "0")
    db = _session()
    _seed_settings(db, enabled=True)
    assert asyncio.run(service.run_once(db)) == []


# --------------------------------------------------------------------------- #
# scheduler
# --------------------------------------------------------------------------- #
def test_scheduler_no_task_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(scheduler, "_TASK", None)
    monkeypatch.setenv("FILINGS_WATCH_ENABLED", "0")
    asyncio.run(scheduler.start_filings_watch())
    assert scheduler._TASK is None

    async def _stop():
        await scheduler.stop_filings_watch()

    asyncio.run(_stop())


def test_scheduler_starts_task_when_enabled(monkeypatch) -> None:
    monkeypatch.setattr(scheduler, "_TASK", None)
    monkeypatch.delenv("FILINGS_WATCH_ENABLED", raising=False)

    async def flow():
        await scheduler.start_filings_watch()
        assert scheduler._TASK is not None
        assert not scheduler._TASK.done()
        await scheduler.stop_filings_watch()

    asyncio.run(flow())
    assert scheduler._TASK is None


# --------------------------------------------------------------------------- #
# routes (settings round-trip + events)
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def client():
    init_db()

    def _auth_headers(email):
        password = "StrongPass123!"
        TestClient(app).post("/api/auth/register", json={"email": email, "password": password, "role": "trader"})
        login = TestClient(app).post("/api/auth/login", json={"email": email, "password": password})
        return {"Authorization": f"Bearer {login.json()['access_token']}"}

    return app, _auth_headers


def test_settings_round_trip(client) -> None:
    app, headers = client
    c = TestClient(app)
    h = headers("filings_settings@example.com")

    created = c.put(
        "/api/filings-watch/settings",
        headers=h,
        json={
            "enabled": True,
            "symbols_source": "custom",
            "custom_symbols": ["tata", " Infosys"],
            "run_hour_utc": 9,
            "notify_on": ["new_document", "adverse_regulatory"],
            "sources": ["nse"],
            "import_limit": 3,
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["enabled"] is True
    assert body["symbols_source"] == "custom"
    assert body["custom_symbols"] == ["TATA", "INFOSYS"]
    assert body["run_hour_utc"] == 9
    assert body["notify_on"] == ["new_document", "adverse_regulatory"]
    assert body["sources"] == ["nse"]
    assert body["import_limit"] == 3

    fetched = c.get("/api/filings-watch/settings", headers=h)
    assert fetched.status_code == 200
    assert fetched.json() == body


def test_events_endpoint_returns_events(client) -> None:
    app, headers = client
    c = TestClient(app)
    h = headers("filings_events@example.com")

    # Write through the same DB dependency the endpoint reads from (respecting any override).
    from backend.api.deps import get_db

    db_gen = app.dependency_overrides.get(get_db, get_db)()
    db = next(db_gen)
    from datetime import datetime, timezone

    # The user id comes from the issued token, not a second DB lookup: in the full suite another
    # test may have pointed the app at a different session, so the lookup could find no user.
    from backend.auth.jwt import decode_token

    user_id = decode_token(h["Authorization"].split(" ", 1)[1])["sub"]
    db.add(FilingsWatchEventORM(user_id=user_id, symbol="TATA", kind="adverse_regulatory", title="WL", detail="483", action_url="/equity/security/TATA?tab=filings", at=datetime(2024, 1, 1, tzinfo=timezone.utc)))
    db.commit()
    db_gen.close()

    listed = c.get("/api/filings-watch/events", headers=h)
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert len(items) >= 1
    assert items[0]["kind"] == "adverse_regulatory"
    assert items[0]["symbol"] == "TATA"
    assert "at" in items[0]


def test_stance_change_detected_when_analyze_persists(monkeypatch) -> None:
    # QC: the real analyze() saves its result. The previous analysis must be read before
    # re-analysing, otherwise "previous" is the new analysis and no change is ever seen.
    from datetime import datetime, timezone

    async def fake_import(db, symbol, sources, limit):
        return [{"title": "Q2 results", "doc_type": "quarterly_filing", "period": "Q2"}]

    async def persisting_analyze(db, symbol, **kwargs):
        payload = {"symbol": symbol, "stance": "cautious", "scores": {"net": -20}, "headwinds": []}
        db.add(FilingAnalysisORM(symbol=symbol, engine="lexical", payload=payload, created_at=datetime(2025, 1, 1, tzinfo=timezone.utc)))
        db.commit()
        return payload

    monkeypatch.setattr(service, "_import_symbol", fake_import)
    monkeypatch.setattr(service, "_safe_analyze", persisting_analyze)
    db = _session()
    _seed_settings(db, enabled=True, symbols_source="custom", custom_symbols=["TATA"], notify_on=["stance_change"])
    db.add(FilingAnalysisORM(symbol="TATA", engine="lexical", payload={"stance": "constructive", "headwinds": []},
                             created_at=datetime(2024, 1, 1, tzinfo=timezone.utc)))
    db.commit()

    events = asyncio.run(service.run_once(db))
    assert [e["kind"] for e in events] == ["stance_change"]
    assert "constructive → cautious" in events[0]["title"]
