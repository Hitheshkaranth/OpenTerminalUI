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


def test_preflight_reports_unknown_availability_without_guessing(api):
    client, _, factory = api
    bars = request()["bars"]
    del bars[0]["available_at"]
    bars[1]["available_at"] = "2025-03-01T00:00:00Z"
    response = client.post(f"{URL}/preflight", json={"bars": bars})
    assert response.status_code == 200
    data = response.json()
    assert data["missing_availability"] == data["late_availability"] == 1
    assert data["exploratory_eligible"] is True
    assert data["point_in_time_eligible"] is False
    assert data["gap_count"] is None
    assert data["adjustment_verified"] is False
    assert data["universe"]["delisted_coverage"] == "not_verified"
    with factory() as db:
        assert db.query(ResearchExperiment).count() == 0


@pytest.mark.parametrize("strategy", ["sma_crossover", "ema_crossover", "buy_hold"])
def test_exploratory_retains_unknown_provenance_and_replays(api, strategy):
    client, _, _ = api
    payload = request()
    payload.update(mode="exploratory", strategy=strategy, raw_source_sha256="a" * 64)
    del payload["bars"][0]["available_at"]
    payload["bars"][1]["available_at"] = "2025-03-01T00:00:00Z"
    response = client.post(URL, json=payload)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["mode"] == "exploratory"
    assert saved["request"]["bars"][0]["available_at"] is None
    assert saved["request"]["raw_source_sha256"] == "a" * 64
    assert saved["readiness"]["point_in_time_eligible"] is False
    assert "not a point-in-time performance claim" in saved["limitations"][-1]
    replay = client.post(f"{URL}/{saved['id']}/replay").json()
    assert replay["matches"] is True
    assert replay["mode"] == "exploratory"
    assert replay["provider_requests"] == 0
    assert client.get(URL).json()["items"][0]["mode"] == "exploratory"


@pytest.mark.parametrize("strategy", ["ema_crossover", "buy_hold"])
def test_additional_strategies_preserve_pit_and_cost_contract(api, strategy):
    client, _, _ = api
    payload = request()
    payload["strategy"] = strategy
    response = client.post(URL, json=payload)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["mode"] == "point_in_time"
    assert saved["readiness"]["point_in_time_eligible"] is True
    assert saved["config"]["fill_delay_bars"] == 1
    assert client.post(f"{URL}/{saved['id']}/replay").json()["matches"] is True
    del payload["bars"][0]["available_at"]
    assert client.post(URL, json=payload).status_code == 422


def test_exploratory_still_rejects_future_and_duplicate_data(api):
    client, _, _ = api
    payload = request()
    payload["mode"] = "exploratory"
    payload["bars"][1] = payload["bars"][0]
    assert client.post(URL, json=payload).status_code == 422
    check = client.post(f"{URL}/preflight", json={"bars": payload["bars"]}).json()
    assert check["exploratory_eligible"] is False
    payload = request()
    payload.update(mode="exploratory", as_of="2025-01-05T00:00:00Z")
    assert client.post(URL, json=payload).status_code == 422


def test_buy_hold_has_no_moving_average_warmup_requirement(api):
    client, _, _ = api
    payload = request()
    payload.update(strategy="buy_hold", long_window=500)
    saved = client.post(URL, json=payload)
    assert saved.status_code == 201, saved.text
    assert saved.json()["results"]["training"]["trades"]


def test_preflight_rejects_invalid_ohlc_and_naive_dates(api):
    client, _, _ = api
    bars = request()["bars"]
    bars[0]["high"] = 1
    assert client.post(f"{URL}/preflight", json={"bars": bars}).status_code == 422
    bars = request()["bars"]
    bars[0]["date"] = "2025-01-01T00:00:00"
    assert client.post(f"{URL}/preflight", json={"bars": bars}).status_code == 422


def test_historical_membership_retains_effective_and_known_dates(api):
    client, _, _ = api
    payload = request()
    payload["historical_memberships"] = [{"universe_name": "Historical index", "effective_from": "2025-01-01T00:00:00Z",
        "effective_until": "2025-01-21T00:00:00Z", "available_at": "2025-01-10T00:00:00Z", "source_url": "https://exchange.example/constituents"}]
    payload["delisting"] = {"effective_at": "2025-02-15T00:00:00Z", "available_at": "2025-02-14T00:00:00Z", "source_url": "https://exchange.example/delisting"}
    response = client.post(URL, json=payload)
    assert response.status_code == 201, response.text
    result = response.json()
    history = result["instrument_history"]
    assert history["membership_evidence"][0]["bars_effectively_in_universe"] == 20
    assert history["membership_evidence"][0]["bars_with_membership_known_at_decision"] == 11
    assert history["delisting_evidence_supplied"] is True
    assert history["survivorship_bias_eliminated"] is False
    assert history["used_for_strategy_selection"] is False
    assert client.post(f"{URL}/{result['id']}/replay").json()["matches"] is True


@pytest.mark.parametrize("mutation", ["future_membership_source", "reversed_membership", "post_delisting_bar", "future_delisting_source", "unsafe_source"])
def test_historical_evidence_rejects_invalid_dates_and_sources(api, mutation):
    client, _, _ = api
    payload = request()
    payload["historical_memberships"] = [{"universe_name": "Index", "effective_from": "2025-01-01T00:00:00Z",
        "effective_until": "2025-01-21T00:00:00Z", "available_at": "2025-01-01T00:00:00Z", "source_url": "https://exchange.example/index"}]
    payload["delisting"] = {"effective_at": "2025-02-15T00:00:00Z", "available_at": "2025-02-14T00:00:00Z", "source_url": "https://exchange.example/delisting"}
    if mutation == "future_membership_source":
        payload["historical_memberships"][0]["available_at"] = "2025-04-01T00:00:00Z"
    elif mutation == "reversed_membership":
        payload["historical_memberships"][0]["effective_until"] = "2024-01-01T00:00:00Z"
    elif mutation == "post_delisting_bar":
        payload["delisting"]["effective_at"] = "2025-01-15T00:00:00Z"
    elif mutation == "future_delisting_source":
        payload["delisting"]["available_at"] = "2025-04-01T00:00:00Z"
    elif mutation == "unsafe_source":
        payload["delisting"]["source_url"] = "javascript:alert(1)"
    assert client.post(URL, json=payload).status_code == 422


@pytest.mark.parametrize("strategy", ["sma_crossover", "ema_crossover", "buy_hold"])
def test_validation_prices_cannot_change_training_results(api, strategy):
    client, _, _ = api
    payload = request()
    payload["strategy"] = strategy
    baseline = client.post(URL, json=payload).json()
    for bar in payload["bars"][25:]:
        for key in ("open", "high", "low", "close"):
            bar[key] *= 10
    changed = client.post(URL, json=payload).json()
    assert changed["results"]["training"] == baseline["results"]["training"]
