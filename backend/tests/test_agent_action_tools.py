"""Tests for the approval-gated action/proposal tools (action_tools.py).

Copies the in-memory-SQLite + monkeypatched-SessionLocal fixture pattern from
test_agent_proposals.py: these tools call create_proposal() directly, so the
same DB wiring applies.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.shared.db import Base


@pytest.fixture()
def test_db():
    from backend.models.agent_proposals import AgentProposal  # noqa: F401 — registers table on Base
    from backend.models import VirtualPortfolio, VirtualPosition, WatchlistORM  # noqa: F401

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    db = db_session()
    yield db
    db.close()


@pytest.fixture()
def monkeypatch_session_local(monkeypatch, test_db):
    mock = MagicMock(return_value=test_db)
    # Import targets before patching backend.shared.db: these modules bind
    # SessionLocal at import time, so patching the shared module first would
    # make monkeypatch record the mock as the "original" and leak it on undo.
    import backend.agent.proposals  # noqa: F401
    import backend.agent.tools.action_tools  # noqa: F401

    monkeypatch.setattr("backend.agent.proposals.SessionLocal", mock)
    monkeypatch.setattr("backend.agent.tools.action_tools.SessionLocal", mock)
    monkeypatch.setattr("backend.shared.db.SessionLocal", mock)
    return mock


@pytest.fixture()
def test_user_id():
    return "test-user-001"


@pytest.fixture()
def test_portfolio_with_position(test_db, test_user_id):
    from backend.models import VirtualPortfolio, VirtualPosition

    p = VirtualPortfolio(
        id="test-portfolio-001",
        user_id=test_user_id,
        name="Test Portfolio",
        initial_capital=100_000.0,
        current_cash=50_000.0,
    )
    test_db.add(p)
    test_db.flush()
    pos = VirtualPosition(
        portfolio_id=p.id,
        symbol="RELIANCE",
        quantity=100.0,
        avg_entry_price=500.0,  # 50,000 position value -> total equity 100,000
    )
    test_db.add(pos)
    test_db.commit()
    return p.id


def _specs(user_id: str) -> dict:
    from backend.agent.tools.action_tools import action_tool_specs

    return {s.name: s for s in action_tool_specs(user_id)}


# ---------------------------------------------------------------------------
# propose_rebalance
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_propose_rebalance_happy_path(monkeypatch_session_local, test_user_id, test_portfolio_with_position, test_db):
    handler = _specs(test_user_id)["propose_rebalance"].handler

    result = await handler({
        "target_weights": {"RELIANCE": 0.3, "TCS": 0.7},
        "rationale": "Diversify into TCS",
    })

    assert result["ok"] is True
    assert result["data"]["status"] == "pending"
    assert "pending human confirmation" in result["data"]["note"].lower()
    deltas = {d["symbol"]: d for d in result["data"]["deltas"]}
    assert deltas["RELIANCE"]["current_weight"] == pytest.approx(0.5)
    assert deltas["RELIANCE"]["target_weight"] == pytest.approx(0.3)
    assert deltas["TCS"]["current_weight"] == pytest.approx(0.0)

    from backend.agent.proposals import list_proposals
    rows = list_proposals(test_db, test_user_id)
    assert len(rows) == 1
    assert rows[0]["type"] == "rebalance"
    assert rows[0]["status"] == "pending"


@pytest.mark.asyncio
async def test_propose_rebalance_weights_must_sum_to_one(monkeypatch_session_local, test_user_id, test_db):
    handler = _specs(test_user_id)["propose_rebalance"].handler

    result = await handler({"target_weights": {"RELIANCE": 0.3, "TCS": 0.3}, "rationale": "bad"})

    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_args"

    from backend.agent.proposals import list_proposals
    assert list_proposals(test_db, test_user_id) == []


@pytest.mark.asyncio
async def test_propose_rebalance_empty_weights(monkeypatch_session_local, test_user_id):
    handler = _specs(test_user_id)["propose_rebalance"].handler

    result = await handler({"target_weights": {}, "rationale": "x"})

    assert result["ok"] is False


@pytest.mark.asyncio
async def test_propose_rebalance_missing_portfolio(monkeypatch_session_local, test_user_id, test_db):
    handler = _specs(test_user_id)["propose_rebalance"].handler

    result = await handler({"target_weights": {"AAPL": 1.0}, "rationale": "x"})

    assert result["ok"] is False
    assert result["error"]["code"] == "not_found"

    from backend.agent.proposals import list_proposals
    assert list_proposals(test_db, test_user_id) == []


# ---------------------------------------------------------------------------
# propose_journal_entry
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_propose_journal_entry_happy_path(monkeypatch_session_local, test_user_id, test_db):
    handler = _specs(test_user_id)["propose_journal_entry"].handler

    result = await handler({"ticker": "tcs", "title": "Thesis", "body": "Strong Q3.", "tags": ["it"]})

    assert result["ok"] is True
    assert result["data"]["status"] == "pending"

    from backend.agent.proposals import list_proposals
    rows = list_proposals(test_db, test_user_id)
    assert len(rows) == 1
    assert rows[0]["type"] == "journal_entry"
    assert rows[0]["payload"]["ticker"] == "TCS"


@pytest.mark.asyncio
async def test_propose_journal_entry_requires_title_and_body(monkeypatch_session_local, test_user_id, test_db):
    handler = _specs(test_user_id)["propose_journal_entry"].handler

    result = await handler({"title": "", "body": ""})

    assert result["ok"] is False
    from backend.agent.proposals import list_proposals
    assert list_proposals(test_db, test_user_id) == []


# ---------------------------------------------------------------------------
# propose_watchlist_remove
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_propose_watchlist_remove_happy_path(monkeypatch_session_local, test_user_id, test_db):
    handler = _specs(test_user_id)["propose_watchlist_remove"].handler

    result = await handler({
        "watchlist_id": "wl-1", "symbols": ["AAPL", "GOOG"], "rationale": "Trimming exposure",
    })

    assert result["ok"] is True
    from backend.agent.proposals import list_proposals
    rows = list_proposals(test_db, test_user_id)
    assert len(rows) == 1
    assert rows[0]["type"] == "watchlist_remove"
    assert rows[0]["payload"]["symbols"] == ["AAPL", "GOOG"]


@pytest.mark.asyncio
async def test_propose_watchlist_remove_empty_symbols(monkeypatch_session_local, test_user_id, test_db):
    handler = _specs(test_user_id)["propose_watchlist_remove"].handler

    result = await handler({"watchlist_id": "wl-1", "symbols": [], "rationale": "x"})

    assert result["ok"] is False
    from backend.agent.proposals import list_proposals
    assert list_proposals(test_db, test_user_id) == []


@pytest.mark.asyncio
async def test_propose_watchlist_remove_requires_rationale(monkeypatch_session_local, test_user_id):
    handler = _specs(test_user_id)["propose_watchlist_remove"].handler

    result = await handler({"watchlist_id": "wl-1", "symbols": ["AAPL"], "rationale": ""})

    assert result["ok"] is False


# ---------------------------------------------------------------------------
# propose_screener_alert
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_propose_screener_alert_happy_path(monkeypatch_session_local, test_user_id, test_db):
    handler = _specs(test_user_id)["propose_screener_alert"].handler

    result = await handler({
        "name": "Cheap quality compounders",
        "criteria": "pe_ratio < 20 and roe > 15",
        "frequency": "weekly",
    })

    assert result["ok"] is True
    from backend.agent.proposals import list_proposals
    rows = list_proposals(test_db, test_user_id)
    assert len(rows) == 1
    assert rows[0]["type"] == "screener_alert"
    assert rows[0]["payload"]["frequency"] == "weekly"


@pytest.mark.asyncio
async def test_propose_screener_alert_requires_criteria(monkeypatch_session_local, test_user_id, test_db):
    handler = _specs(test_user_id)["propose_screener_alert"].handler

    result = await handler({"name": "Empty", "criteria": ""})

    assert result["ok"] is False
    from backend.agent.proposals import list_proposals
    assert list_proposals(test_db, test_user_id) == []


@pytest.mark.asyncio
async def test_propose_screener_alert_invalid_frequency(monkeypatch_session_local, test_user_id):
    handler = _specs(test_user_id)["propose_screener_alert"].handler

    result = await handler({"name": "X", "criteria": "pe < 10", "frequency": "hourly"})

    assert result["ok"] is False


# ---------------------------------------------------------------------------
# Permission boundary: every action spec must be a non-"none" write_class
# ---------------------------------------------------------------------------

def test_all_action_specs_have_nonnone_write_class():
    specs = _specs("any-user")
    assert len(specs) == 4
    for name, spec in specs.items():
        assert spec.write_class != "none", f"{name} would leak through ToolRegistry.filtered(allow_writes=False)"
        assert spec.read_only is False


def test_action_tool_specs_have_valid_json_schema():
    for spec in _specs("any-user").values():
        params = spec.parameters
        assert params["type"] == "object"
        for required_field in params.get("required", []):
            assert required_field in params["properties"]
        tool_def = spec.to_def()
        assert tool_def.name == spec.name


# ---------------------------------------------------------------------------
# User isolation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_proposals_isolated_by_user(monkeypatch_session_local, test_db):
    handler_a = _specs("user-a")["propose_journal_entry"].handler
    handler_b = _specs("user-b")["propose_journal_entry"].handler

    await handler_a({"title": "A note", "body": "body a"})
    await handler_b({"title": "B note", "body": "body b"})

    from backend.agent.proposals import list_proposals

    rows_a = list_proposals(test_db, "user-a")
    rows_b = list_proposals(test_db, "user-b")

    assert len(rows_a) == 1 and rows_a[0]["user_id"] == "user-a"
    assert len(rows_b) == 1 and rows_b[0]["user_id"] == "user-b"
