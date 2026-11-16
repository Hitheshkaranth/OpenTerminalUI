from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.agent.historical import historical_context, validate_historical_as_of
from backend.agent.tools import historical_tools
from backend.agent.tools.historical_tools import build_historical_registry
from backend.models import DataVersionORM, FundamentalsPitORM, NewsArticle
from backend.models.agent_memory import AgentRun, AgentRunExecution, AgentThread
from backend.shared.db import Base


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    session = factory()
    session.add(DataVersionORM(id="dataset", name="fixture", source="test", is_active=True))
    session.commit()
    monkeypatch.setattr(historical_tools, "SessionLocal", factory)
    yield session
    session.close()
    engine.dispose()


def fact(db, metric="revenue", value=100, released="2025-01-15", **kwargs):
    args = dict(symbol="AAPL", metric=metric, value=value, fiscal_period="2024-Q4", as_of_date=released,
                data_version_id="dataset", source="fmp", release_date_estimated=False)
    args.update(kwargs)
    db.add(FundamentalsPitORM(**args))
    db.commit()


def news(db, title="past", released="2025-01-20T10:00:00+00:00", **kwargs):
    args = dict(source="Reuters", title=title, url=f"https://example.com/{title}", summary=f"{title} summary",
                published_at="2099-01-01T00:00:00Z", source_published_at=released,
                publication_verified=True, publication_source="finnhub", tickers='["AAPL"]',
                sentiment_score=999, sentiment_label="Future analysis")
    args.update(kwargs)
    db.add(NewsArticle(**args))
    db.commit()


@pytest.mark.asyncio
async def test_released_facts_exclude_poison_latest_estimated_and_invalid_metadata(db):
    fact(db)
    fact(db, value=999999, released="2025-03-01", fiscal_period="2024-Q4")
    fact(db, metric="pe", value=999, released="2025-01-20", release_date_estimated=True)
    fact(db, metric="roe", value=123, released="", source="")
    fact(db, metric="margin", value=321, released="2025-01-32")
    registry = build_historical_registry("2025-01-31")
    result = await registry.execute("get_historical_fundamentals", {"symbol": "AAPL", "as_of": "2099-01-01"})
    assert result["ok"] is True
    assert result["data"]["facts"] == [{"metric": "revenue", "value": 100, "fiscal_period": "2024-Q4",
        "released_at": "2025-01-15", "source": "fmp", "release_date_estimated": False}]
    assert "999999" not in json.dumps(result)
    assert result["data"]["historical_as_of"] == "2025-01-31"


@pytest.mark.asyncio
async def test_fiscal_period_does_not_replace_release_availability(db):
    fact(db, fiscal_period="2020-Q1", released="2025-02-01")
    result = await build_historical_registry("2025-01-31").execute("get_historical_fundamentals", {"symbol": "AAPL"})
    assert result["error"]["code"] == "historical_unavailable"


@pytest.mark.asyncio
async def test_historical_news_requires_source_date_not_ingestion_or_sentiment(db):
    news(db)
    news(db, title="latest poison", released="2025-02-01T00:00:00+00:00")
    news(db, title="legacy poison", released="2025-01-01T00:00:00+00:00", publication_verified=False)
    news(db, title="undated poison", released=None)
    news(db, title="bad date", released="bad")
    news(db, title="future offset", released="2025-01-31T23:30:00-05:00")
    result = await build_historical_registry("2025-01-31").execute("get_historical_news", {"symbol": "AAPL", "historical_as_of": "2099-01-01"})
    assert result["ok"] is True
    assert [row["title"] for row in result["data"]["articles"]] == ["past"]
    assert "sentiment" not in json.dumps(result["data"])
    assert "poison" not in json.dumps(result)


@pytest.mark.asyncio
async def test_filings_bound_cutoff_and_allowlist_excludes_all_live_and_action_paths(db, monkeypatch):
    from backend.agent.tools import filings_tools
    calls = []
    async def search(args):
        calls.append(args)
        return {"ok": True}
    monkeypatch.setattr(filings_tools, "search_company_filings", search)
    registry = build_historical_registry("2025-01-31")
    assert set(registry.names()) == {"get_historical_news", "get_historical_fundamentals", "search_company_filings"}
    for name in ["get_stock_snapshot", "get_portfolio", "get_paper_positions", "get_news", "screen_stocks",
                 "get_trade_size", "propose_paper_order", "execute_order", "backtest_symbol"]:
        with pytest.raises(KeyError):
            await registry.execute(name, {})
    await registry.execute("search_company_filings", {"symbol": "AAPL", "question": "risks", "as_of": "2099-01-01"})
    assert calls[0]["as_of"] == "2025-01-31"
    assert all(registry.get(name).read_only and registry.get(name).write_class == "none" for name in registry.names())


def remember(db, cutoff=None, user="me", run_id="run"):
    db.add(AgentThread(id="thread", user_id=user))
    db.add(AgentRun(id=run_id, user_id=user, thread_id="thread", prompt="first"))
    context = {"symbol": "AAPL", "market": "US"}
    if cutoff:
        context["historical_as_of"] = cutoff
    db.add(AgentRunExecution(run_id=run_id, user_id=user, spec_json=json.dumps({"context": context})))
    db.commit()


def test_followup_inherits_cutoff_and_subject_but_strips_current_screen_metrics(db):
    remember(db, "2025-01-31")
    context = historical_context(db, "me", "thread", {"current_price": 999, "dossier_id": "future"})
    assert context == {"symbol": "AAPL", "market": "US", "historical_as_of": "2025-01-31"}
    with pytest.raises(ValueError, match="cannot change"):
        historical_context(db, "me", "thread", {}, "2025-02-01")


def test_cannot_start_historical_research_in_existing_live_thread(db):
    remember(db)
    with pytest.raises(ValueError, match="cannot change"):
        historical_context(db, "me", "thread", {}, "2025-01-31")


@pytest.mark.parametrize("value", ["2025-1-1", "2025-13-01", "bad", "2025-01-01T00:00:00Z", "", 123, True, "2999-01-01"])
def test_strict_cutoff_validation(value):
    with pytest.raises(ValueError):
        validate_historical_as_of(value)


@pytest.mark.parametrize("mode", ["debate", "ensemble", "strategy", "screener"])
def test_http_rejects_unsupported_historical_modes_before_run_creation(db, mode):
    from backend.api.routes import agent
    from backend.auth.deps import get_current_user
    app = FastAPI()
    app.include_router(agent.router)
    app.dependency_overrides[agent.get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="me")
    response = TestClient(app).post("/agent/runs", json={"prompt": "Research AAPL", "mode": mode,
        "historical_as_of": "2025-01-31"})
    assert response.status_code == 422
    assert db.query(AgentRun).count() == 0


@pytest.mark.asyncio
async def test_orchestrator_cannot_use_live_registry_or_future_memory(db):
    from backend.agent.orchestrator import Orchestrator
    from backend.agent.tools.registry import ToolRegistry, ToolSpec
    from backend.services.llm.base import AssistantMessage, LLMMessage
    observed = []
    class Provider:
        async def complete(self, messages, tools=None, **kwargs):
            observed.append((messages, tools))
            return AssistantMessage(content="Source-dated evidence is unavailable.")
    registry = ToolRegistry()
    registry.register(ToolSpec("get_stock_snapshot", "POISON", {}, None, True))
    orchestrator = Orchestrator(provider=Provider(), registry=registry)
    events = [event async for event in orchestrator.run("find companies with roe",
        screen_context={"symbol": "AAPL", "historical_as_of": "2025-01-31", "current_price": "POISON"},
        memory_directive="FUTURE MEMORY POISON", history=[LLMMessage(role="assistant", content="FUTURE HISTORY POISON")])]
    assert events[-1]["type"] == "final"
    messages, tools = observed[0]
    text = " ".join(message.content or "" for message in messages)
    assert "POISON" not in text
    assert "screen_stocks tool" not in text
    assert "leakage-free model backtest" in text
    assert set(tool.name for tool in tools) == {"get_historical_fundamentals", "get_historical_news", "search_company_filings"}


def test_news_bootstrap_legacy_rows_remain_unverified(monkeypatch):
    from backend.shared import db as shared
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE news_articles (id INTEGER PRIMARY KEY, published_at TEXT)"))
        connection.execute(text("INSERT INTO news_articles VALUES (1,'2025-01-01')"))
    monkeypatch.setattr(shared, "engine", engine)
    shared._ensure_news_availability_columns()
    shared._ensure_news_availability_columns()
    with engine.connect() as connection:
        row = connection.execute(text("SELECT source_published_at,publication_verified FROM news_articles")).one()
    assert row[0] is None and row[1] == 0
    engine.dispose()


def test_http_historical_followup_persists_cutoff_and_ticker(db):
    from backend.api.routes import agent
    from backend.auth.deps import get_current_user
    app = FastAPI()
    app.include_router(agent.router)
    app.dependency_overrides[agent.get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="me")
    db.add(AgentThread(id="thread", user_id="me"))
    db.commit()
    client = TestClient(app)
    first = client.post("/agent/runs", json={"prompt": "Research AAPL", "thread_id": "thread", "ticker": "AAPL",
        "historical_as_of": "2025-01-31", "context": {"market": "US", "current_price": 999999}})
    assert first.status_code == 200
    first_spec = json.loads(db.get(AgentRunExecution, first.json()["run_id"]).spec_json)
    assert first_spec["context"] == {"symbol": "AAPL", "market": "US", "historical_as_of": "2025-01-31"}
    followup = client.post("/agent/runs", json={"prompt": "What about margins?", "thread_id": "thread"})
    assert followup.status_code == 200
    followup_spec = json.loads(db.get(AgentRunExecution, followup.json()["run_id"]).spec_json)
    assert followup_spec["context"] == first_spec["context"]
    rejected = client.post("/agent/runs", json={"prompt": "Change date", "thread_id": "thread", "historical_as_of": "2025-02-01"})
    assert rejected.status_code == 422


@pytest.mark.parametrize("raw", [None, "", "bad", True, float("inf"), float("nan")])
def test_news_ingestion_fallback_dates_never_gain_verified_publication(raw):
    from backend.bg_services.news_ingestor import normalize_news_record
    item = normalize_news_record({"headline": "Test", "url": "https://example.com/date", "datetime": raw}, "finnhub")
    assert item is not None
    assert item.source_published_at is None
    assert item.publication_verified is False


def test_news_source_publication_persists_and_can_reingest_legacy(db, monkeypatch):
    from backend.bg_services import news_ingestor
    factory = sessionmaker(bind=db.bind)
    monkeypatch.setattr(news_ingestor, "SessionLocal", factory)
    item = news_ingestor.normalize_news_record({"headline": "Source report", "url": "https://example.com/dated",
        "datetime": 1737374400, "related": "AAPL"}, "finnhub")
    db.add(NewsArticle(source="legacy", title="Old", url=item.url, published_at="2025-01-01T00:00:00Z"))
    db.commit()
    assert news_ingestor.NewsIngestor()._store_news([item]) == 0
    db.expire_all()
    row = db.query(NewsArticle).one()
    assert row.publication_verified is True
    assert row.publication_source == "finnhub"
    assert row.source_published_at == item.source_published_at
    assert row.title == "Source report"


def test_historical_marker_survives_permission_filtered_registry():
    registry = build_historical_registry("2025-01-31").filtered(allow_writes=False)
    assert registry.historical_as_of == "2025-01-31"


def test_new_alembic_revision_ids_fit_postgresql_version_column():
    import ast
    from pathlib import Path
    for file in (Path(__file__).parents[1] / "alembic" / "versions").glob("*.py"):
        if file.name[:4] < "0015":
            continue
        for node in ast.parse(file.read_text()).body:
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "revision" for target in node.targets):
                assert len(ast.literal_eval(node.value)) <= 32, file.name


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["debate", "ensemble", "strategy", "screener"])
async def test_direct_specialized_orchestrators_cannot_bypass_historical_mode(mode):
    from importlib import import_module
    classes = {"debate": ("debate", "DebateOrchestrator"), "ensemble": ("ensemble", "EnsembleOrchestrator"),
               "strategy": ("strategy_loop", "StrategyLoopOrchestrator"), "screener": ("screener", "ScreenerAgentOrchestrator")}
    module, name = classes[mode]
    cls = getattr(import_module(f"backend.agent.{module}.orchestrator"), name)
    instance = object.__new__(cls)
    with pytest.raises(ValueError, match="supports standard/deep only"):
        _ = [event async for event in instance.run("AAPL", screen_context={"historical_as_of": "2025-01-31"})]
