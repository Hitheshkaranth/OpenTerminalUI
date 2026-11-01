from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from backend.shared.db import Base
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import UserScreenORM
from backend.screen_monitoring import service, scheduler
from backend.screen_monitoring.models import ScreenSchedule, ScreenChange
from backend.screen_monitoring.routes import router

NOW = datetime(2026, 11, 1, tzinfo=timezone.utc)


def frame(roe=21, age=0, ticker="AAPL"):
    return pd.DataFrame([{"ticker": ticker, "roe_pct": roe, "pe": 18, "updated_at": (NOW-timedelta(hours=age)).isoformat()}])


@pytest.fixture
def api(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        db.add(UserScreenORM(id="screen", user_id="owner", name="Quality", query="ROE > 20 AND PE < 25", description="", columns_config=[], viz_config={}, is_public=False, upvotes=0))
        db.commit()
    app = FastAPI(); app.include_router(router)
    state = {"user": "owner"}
    def db():
        with Session() as session:
            yield session
    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=state["user"])
    monkeypatch.setattr(service, "utcnow", lambda: NOW)
    monkeypatch.setattr(service, "_load_universe_symbols", lambda *args: ["AAPL", "MSFT"])
    monkeypatch.setattr(service, "load_screener_df", lambda *args: frame())
    with TestClient(app) as client:
        yield client, state, Session
    engine.dispose()


URL = "/api/screen-monitoring"
PAYLOAD = {"screen_id": "screen", "universe": "sp_500", "market": "US", "frequency": "daily", "max_age_hours": 24}


def test_preview_missing_unknown_stale_and_full_membership():
    result = service.evaluate("ROE > 20 ORDER BY ROE DESC LIMIT 1", ["AAPL", "MSFT", "GOOG", "META", "NVDA"],
        pd.concat([frame(), frame(22, ticker="MSFT"), frame(None, ticker="GOOG"), frame(30, age=30, ticker="META")]), 24, NOW)
    assert len(result["matches"]) == 2  # LIMIT is presentation, never membership.
    assert result["coverage"] == {"requested": 5, "evaluated": 2, "missing": ["NVDA"], "stale": ["META"], "unknown": ["GOOG"]}


@pytest.mark.parametrize("query", ["ROCE > 20", "roe > @secret", "roe > 10 + 5", "True", "roe == '20'", "roe > pe", "roe", "roe > 20 OR pe"])
def test_unsupported_and_unsafe_rules_are_explicit(query):
    with pytest.raises(ValueError):
        service.compile_rules(query)


def test_owner_scoping_and_preview(api):
    client, state, _ = api
    preview = client.post(URL + "/preview", json=PAYLOAD)
    assert preview.status_code == 200, preview.text
    assert preview.json()["coverage"]["evaluated"] == 1
    created = client.post(URL, json=PAYLOAD)
    assert created.status_code == 201, created.text
    row = created.json()
    assert client.post(URL, json={**PAYLOAD, "frequency": "weekly"}).json()["id"] == row["id"]
    state["user"] = "intruder"
    assert client.get(URL).json()["items"] == []
    assert client.post(URL + "/preview", json=PAYLOAD).status_code == 404
    for method, suffix in [("get", ""), ("post", "/run"), ("delete", "")]:
        assert getattr(client, method)(URL + "/" + row["id"] + suffix).status_code == 404
    assert client.patch(URL + "/" + row["id"], json={"enabled": False}).status_code == 404


def test_baseline_transition_outage_recovery_and_query_reset(api):
    client, _, Session = api
    ident = client.post(URL, json=PAYLOAD).json()["id"]
    with Session() as db:
        row = db.get(ScreenSchedule, ident)
        check = lambda df: service.record_run(db, row, service.evaluate("ROE > 20 AND PE < 25", ["AAPL"], df, 24, NOW))
        assert check(frame(19))["changes"] == []
        result = check(frame(21))
        assert len(result["changes"]) == 1
        assert result["changes"][0]["kind"] == "entered"
        assert result["changes"][0]["before"]["roe"] == 19
        assert result["changes"][0]["after"]["roe"] == 21
        assert result["changes"][0]["rules"] == ["roe > 20"]
        assert check(pd.DataFrame())["matches"] == []
        assert len(check(frame(21, age=48))["changes"]) == 1
        assert len(check(frame(None))["changes"]) == 1
        assert len(check(frame(21))["changes"]) == 1
        changes = check(frame(18))["changes"]
        assert len(changes) == 2
        assert changes[0]["kind"] == "exited"
        assert len(check(frame(18))["changes"]) == 2
        service.record_run(db, row, service.evaluate("ROE > 10", ["AAPL"], frame(18), 24, NOW))
        assert db.query(ScreenChange).count() == 2  # Editing a query establishes a new baseline.


@pytest.mark.asyncio
async def test_due_scheduler_runs_only_enabled_due_and_releases_lease(api, monkeypatch):
    client, _, Session = api
    ident = client.post(URL, json=PAYLOAD).json()["id"]
    monkeypatch.setattr(scheduler, "SessionLocal", Session)
    monkeypatch.setattr(scheduler, "utcnow", lambda: NOW)
    calls = []
    async def run(db, row):
        calls.append(row.id)
        return service.record_run(db, row, service.evaluate("ROE > 20 AND PE < 25", ["AAPL"], frame(), 24, NOW))
    monkeypatch.setattr(service, "run", run)
    assert await scheduler.check_due_screens() == {"checked": 1, "failed": 0}
    assert await scheduler.check_due_screens() == {"checked": 0, "failed": 0}
    assert calls == [ident]
    with Session() as db:
        row = db.get(ScreenSchedule, ident)
        row.next_run_at = NOW
        row.enabled = False
        db.commit()
    assert await scheduler.check_due_screens() == {"checked": 0, "failed": 0}

@pytest.mark.asyncio
async def test_refresh_includes_existing_symbols_rotates_and_never_writes_failed_data(monkeypatch):
    from backend.api import deps
    from backend.services import materialized_store
    calls, writes = [], []
    class Fetcher:
        async def fetch_stock_snapshot(self, symbol):
            calls.append(symbol)
            if symbol == "MSFT":
                raise RuntimeError("Provider unavailable")
            return {"ticker": symbol, "roe_pct": 22, "pe": 18, "pb": 3}
    async def get(): return Fetcher()
    monkeypatch.setattr(deps, "get_unified_fetcher", get)
    monkeypatch.setattr(materialized_store, "upsert_screener_rows", lambda rows: writes.extend(rows))
    monkeypatch.setenv("SCREEN_MONITOR_REFRESH_CAP", "2")
    result = await service.refresh_observations(["AAPL", "MSFT", "GOOG"], 0)
    assert {key: result[key] for key in ("attempted", "refreshed", "failed", "next_cursor")} == {"attempted": 2, "refreshed": 1, "failed": ["MSFT"], "next_cursor": 2}
    assert result["provenance"]["AAPL"]["source"] == "unreported"
    assert writes[0]["ticker"] == "AAPL"
    assert writes[0]["pb_calc"] == 3
    assert len(writes) == 1
    await service.refresh_observations(["AAPL", "MSFT", "GOOG"], result["next_cursor"])
    assert calls == ["AAPL", "MSFT", "GOOG", "AAPL"]


@pytest.mark.asyncio
async def test_scheduler_failure_preserves_previous_results_and_retries(api, monkeypatch):
    client, _, Session = api
    ident = client.post(URL, json=PAYLOAD).json()["id"]
    monkeypatch.setattr(scheduler, "SessionLocal", Session)
    monkeypatch.setattr(scheduler, "utcnow", lambda: NOW)
    async def fail(db, row):
        raise RuntimeError("Provider down")
    monkeypatch.setattr(service, "run", fail)
    assert await scheduler.check_due_screens() == {"checked": 0, "failed": 1}
    with Session() as db:
        row = db.get(ScreenSchedule, ident)
        assert row.lease_until is None
        assert service.aware(row.next_run_at) == NOW + timedelta(minutes=15)
        assert row.error


def test_run_lease_prevents_duplicate_manual_work(api):
    client, _, Session = api
    ident = client.post(URL, json=PAYLOAD).json()["id"]
    with Session() as db:
        row = db.get(ScreenSchedule, ident)
        row.lease_until = datetime.now(timezone.utc) + timedelta(minutes=5)
        db.commit()
    assert client.post(URL + "/" + ident + "/run").status_code == 409


@pytest.mark.parametrize("metadata", [{"data_status": "synthetic"}, {"provenance": {"quality": "mock"}}, {"provenance": {"source": "simulated-provider"}}, {"details": {"price_source": "synthetic"}}, {"meta": {"providers": [{"is_synthetic": True}]}}, {"is_mock": True}])
def test_nested_synthetic_provenance_is_rejected(metadata):
    assert service.has_synthetic_provenance(metadata)


@pytest.mark.asyncio
async def test_synthetic_refresh_never_updates_cached_observation(monkeypatch):
    from backend.api import deps
    from backend.services import materialized_store
    class Fetcher:
        async def fetch_stock_snapshot(self, symbol):
            return {"roe_pct": 99, "pe": 3, "provenance": {"source": "fallback", "quality": "synthetic"}}
    async def get(): return Fetcher()
    monkeypatch.setattr(deps, "get_unified_fetcher", get)
    writes = []
    monkeypatch.setattr(materialized_store, "upsert_screener_rows", lambda rows: writes.extend(rows))
    result = await service.refresh_observations(["AAPL"])
    assert result["rejected_synthetic"] == ["AAPL"]
    assert result["refreshed"] == 0
    assert writes == []
    assert not service.has_synthetic_provenance({"is_synthetic": False, "provenance": {"source": "exchange", "quality": "delayed"}})


def test_evaluation_excludes_explicit_synthetic_cached_rows():
    rows = frame(99)
    rows["provenance"] = [{"quality": "synthetic"}]
    result = service.evaluate("ROE > 20", ["AAPL"], rows, 24, NOW)
    assert result["matches"] == []
    assert result["coverage"]["unknown"] == ["AAPL"]


@pytest.mark.asyncio
async def test_rejected_refresh_cannot_reuse_a_previous_cache_match(api, monkeypatch):
    client, _, Session = api
    ident = client.post(URL, json=PAYLOAD).json()["id"]
    async def rejected(*args):
        return {"rejected_synthetic": ["AAPL"], "next_cursor": 0, "attempted": 1, "refreshed": 0}
    monkeypatch.setattr(service, "refresh_observations", rejected)
    with Session() as db:
        result = await service.run(db, db.get(ScreenSchedule, ident))
    assert result["matches"] == []
    assert result["coverage"]["unknown"] == ["AAPL"]
