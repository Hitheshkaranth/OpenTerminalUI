"""Durable user-scoped exposure counts, append-only metadata and safe recovery."""

import importlib
import json
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.agent.strategy_loop.experiments import StrategyExperimentLog
from backend.agent.strategy_loop.holdout import SMAHoldoutSession
from backend.agent.strategy_loop.orchestrator import StrategyLoopOrchestrator
from backend.agent.strategy_loop.walkforward import PROTOCOL_VERSION, protocol_manifest
from backend.auth.deps import get_current_user
from backend.models.agent_strategy_experiment import AgentStrategyExperiment
from backend.services.llm.base import AssistantMessage


@pytest.fixture
def ledger():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    AgentStrategyExperiment.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    yield StrategyExperimentLog(factory), factory
    engine.dispose()


def manifest():
    return {"split": {"test_start": "2024-01-01T00:00:00+00:00", "test_end": "2024-06-30T00:00:00+00:00"},
            "walk_forward": protocol_manifest(), "universe": ["AAPL"]}


def register(log, run="run1", user="user1", dataset="a" * 64, symbol="AAPL"):
    return log.prepare(user_id=user, run_id=run, dataset_id=dataset, symbol=symbol,
                       protocol_version=PROTOCOL_VERSION, manifest=manifest())


def test_counts_survive_new_log_instances_and_are_user_and_symbol_scoped(ledger):
    log, factory = ledger
    assert register(log)["prior_test_exposures"] == 0
    first = log.open_tests(user_id="user1", run_id="run1", selection={"winner": {"short_window": 20}})
    assert first["prior_test_exposures"] == 0 and first["recorded_test_exposures"] == 1
    restored = StrategyExperimentLog(factory)
    assert register(restored, run="run2")["prior_test_exposures"] == 1
    second = restored.open_tests(user_id="user1", run_id="run2", selection={"winner": {"short_window": 10}})
    assert second["prior_test_exposures"] == second["prior_overlapping_holdout_exposures"] == 1
    assert register(restored, run="other-user", user="user2")["prior_test_exposures"] == 0
    assert register(restored, run="other-symbol", symbol="MSFT")["prior_test_exposures"] == 0
    assert all(event["run_id"] != "other-user" for event in restored.list_events("user1"))


def test_changed_dataset_hash_still_discloses_overlapping_holdout_dates(ledger):
    log, _ = ledger
    register(log)
    log.open_tests(user_id="user1", run_id="run1", selection={})
    changed = register(log, run="changed-prices", dataset="b" * 64)
    assert changed["prior_test_exposures"] == 0
    assert changed["prior_overlapping_holdout_exposures"] == 1
    opening = log.open_tests(user_id="user1", run_id="changed-prices", selection={})
    assert opening["prior_overlapping_holdout_exposures"] == 1


def test_same_run_is_idempotent_until_tests_open_and_interrupted_opening_blocks(ledger):
    log, _ = ledger
    first = register(log)
    assert register(log)["experiment_id"] == first["experiment_id"]
    assert len(log.list_events("user1")) == 1
    with pytest.raises(ValueError, match="immutable dataset"):
        register(log, dataset="b" * 64)
    log.open_tests(user_id="user1", run_id="run1", selection={})
    with pytest.raises(ValueError, match="already opened"):
        log.open_tests(user_id="user1", run_id="run1", selection={})
    with pytest.raises(ValueError, match="Reopening is blocked"):
        register(log)
    with pytest.raises(ValueError, match="Reopening is blocked"):
        log.replay_if_completed(user_id="user1", run_id="run1")
    assert len([event for event in log.list_events("user1") if event["event_kind"] == "tests_opened"]) == 1


def test_completed_snapshots_replay_and_cannot_be_replaced_or_mutated(ledger):
    log, factory = ledger
    register(log)
    log.open_tests(user_id="user1", run_id="run1", selection={})
    log.complete(user_id="user1", run_id="run1", results={"answer": "original"})
    replay = log.replay_if_completed(user_id="user1", run_id="run1")
    assert replay["results"] == {"answer": "original"} and replay["same_run_replay"]
    with pytest.raises(ValueError, match="cannot be replaced"):
        log.complete(user_id="user1", run_id="run1", results={"answer": "modified"})
    db = factory()
    row = db.query(AgentStrategyExperiment).filter_by(event_kind="registered").one()
    row.payload = {"modified": True}
    with pytest.raises(ValueError, match="append-only"):
        db.commit()
    db.rollback()
    db.delete(row)
    with pytest.raises(ValueError, match="append-only"):
        db.commit()
    db.rollback()
    db.close()
    assert log.list_events("user1")[-1]["payload"] == manifest()


def history():
    close = 100 + np.arange(240) * 0.1 + 8 * np.sin(np.arange(240) / 8)
    return pd.DataFrame({"date": pd.date_range("2024-01-01", periods=240), "open": close,
                         "high": close + 1, "low": close - 1, "close": close})


PARAMS = {"strategy": "sma_crossover", "ticker": "AAPL", "short_window": 20, "long_window": 50}


class Provider:
    def __init__(self):
        self.calls = 0

    async def complete(self, messages, **kwargs):
        self.calls += 1
        return AssistantMessage(content=json.dumps(PARAMS), model="fixture")


class Registry:
    async def execute(self, name, args):
        assert name == "validate_backtest"
        return {}


@pytest.mark.asyncio
async def test_full_run_records_before_testing_and_completed_resume_replays_without_fetch_or_model(ledger, monkeypatch):
    log, factory = ledger
    loads = []

    async def loader(ticker):
        loads.append(ticker)
        session = SMAHoldoutSession(ticker, history())
        original = session.evaluate_holdout

        def opened_first(params):
            assert any(event["event_kind"] == "tests_opened" for event in log.list_events("user1"))
            return original(params)

        monkeypatch.setattr(session, "evaluate_holdout", opened_first)
        return session

    provider = Provider()
    first = [event async for event in StrategyLoopOrchestrator(provider=provider, registry=Registry(), max_rounds=1,
        holdout_loader=loader, user_id="user1", run_id="run-full", experiment_log=log).run("AAPL")]
    assert len([event for event in first if event["type"] == "final"]) == 1
    assert "Expanding walk-forward" in first[-1]["content"]
    assert "Prior recorded test openings: 0" in first[-1]["content"]
    assert {event["event_kind"] for event in log.list_events("user1")} == {"registered", "tests_opened", "completed"}

    async def no_fetch(ticker):
        pytest.fail("a completed run must replay without fetching another dataset")

    restored_provider = Provider()
    replay = [event async for event in StrategyLoopOrchestrator(provider=restored_provider, registry=Registry(),
        holdout_loader=no_fetch, user_id="user1", run_id="run-full", experiment_log=StrategyExperimentLog(factory)).run("AAPL")]
    assert restored_provider.calls == 0 and provider.calls == 1 and loads == ["AAPL"]
    assert "no tests were recomputed" in replay[-1]["content"]
    assert "Reused research data" in replay[-1]["content"]
    assert len(log.list_events("user1")) == 3

    repeated = [event async for event in StrategyLoopOrchestrator(provider=Provider(), registry=Registry(), max_rounds=1,
        holdout_loader=loader, user_id="user1", run_id="new-hypothesis", experiment_log=log).run("AAPL")]
    assert "Prior recorded test openings: 1" in repeated[-1]["content"]
    assert "Reused research data" in repeated[-1]["content"]


@pytest.mark.asyncio
async def test_interrupted_opening_blocks_recomputation_before_data_or_model(ledger):
    log, _ = ledger
    register(log)
    log.open_tests(user_id="user1", run_id="run1", selection={})

    async def no_fetch(ticker):
        pytest.fail("interrupted opening must block before a new fetch")

    provider = Provider()
    events = [event async for event in StrategyLoopOrchestrator(provider=provider, registry=Registry(),
        holdout_loader=no_fetch, user_id="user1", run_id="run1", experiment_log=log).run("AAPL")]
    assert provider.calls == 0
    assert "Reopening is blocked" in events[-1]["content"]
    assert not any(event["type"] == "tool_call" for event in events)


@pytest.mark.asyncio
async def test_momentum_fails_closed_without_historical_membership():
    class MomentumProvider:
        async def complete(self, messages, **kwargs):
            return AssistantMessage(content='{"strategy":"momentum_rotation","tickers":["AAPL","MSFT"],"top_n":1}', model="fixture")

    class NoBasket:
        async def execute(self, name, args):
            pytest.fail("present-day ticker baskets cannot bypass universe membership")

    events = [event async for event in StrategyLoopOrchestrator(provider=MomentumProvider(), registry=NoBasket(),
        holdout_loader=None).run("AAPL")]
    assert "verified historical universe membership" in events[-1]["content"]
    assert not any(event["type"] == "tool_call" for event in events)


@pytest.mark.asyncio
async def test_failed_exposure_reservation_never_opens_tests():
    session = SMAHoldoutSession("AAPL", history())

    async def loader(ticker):
        return session

    class UnavailableLog:
        def replay_if_completed(self, **kwargs):
            return None

        def prepare(self, **kwargs):
            return {"status": "registered", "dataset_id": kwargs["dataset_id"]}

        def open_tests(self, **kwargs):
            raise RuntimeError("database unavailable")

    events = [event async for event in StrategyLoopOrchestrator(provider=Provider(), registry=Registry(),
        holdout_loader=loader, user_id="user1", run_id="reserved-failure", experiment_log=UnavailableLog(), max_rounds=1).run("AAPL")]
    assert "Tests were not opened" in events[-1]["content"]
    assert not any(event.get("name") in {"evaluate_strategy_holdout", "evaluate_strategy_walk_forward"} for event in events)
    assert not session._sealed


@pytest.mark.asyncio
async def test_failed_result_commit_keeps_exposure_and_blocks_retry(ledger, monkeypatch):
    log, factory = ledger

    async def loader(ticker):
        return SMAHoldoutSession(ticker, history())

    def no_commit(**kwargs):
        raise RuntimeError("result commit unavailable")

    monkeypatch.setattr(log, "complete", no_commit)
    events = [event async for event in StrategyLoopOrchestrator(provider=Provider(), registry=Registry(),
        holdout_loader=loader, user_id="user1", run_id="commit-failure", experiment_log=log, max_rounds=1).run("AAPL")]
    assert "Result snapshot could not be saved" in events[-1]["content"]
    assert {event["event_kind"] for event in log.list_events("user1")} == {"registered", "tests_opened"}
    with pytest.raises(ValueError, match="Reopening is blocked"):
        StrategyExperimentLog(factory).replay_if_completed(user_id="user1", run_id="commit-failure")


def test_experiment_history_route_is_user_scoped(ledger, monkeypatch):
    from backend.api.routes import agent as route
    log, factory = ledger
    register(log, user="user1", run="mine")
    register(log, user="user2", run="theirs")
    monkeypatch.setattr(route, "SessionLocal", factory)
    app = FastAPI()
    app.include_router(route.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="user1")
    response = TestClient(app).get("/api/agent/strategy-experiments")
    assert response.status_code == 200
    assert [event["run_id"] for event in response.json()["events"]] == ["mine"]


def test_migration_creates_accounting_constraints_and_downgrades():
    migration = importlib.import_module("backend.alembic.versions.0016_strategy_experiments")
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            inspector = inspect(connection)
            assert "agent_strategy_experiments" in inspector.get_table_names()
            assert any(item["name"] == "uq_strategy_experiment_run_event" for item in inspector.get_unique_constraints("agent_strategy_experiments"))
            migration.downgrade()
            assert "agent_strategy_experiments" not in inspect(connection).get_table_names()
    engine.dispose()
