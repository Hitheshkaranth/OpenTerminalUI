"""Comprehensive tests for agent proposals (C14).

Tests proposal CRUD, confirm/reject/expire, propose_* tools, and API routes.
Uses in-memory SQLite and monkeypatches SessionLocal.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.shared.db import Base


# ---------------------------------------------------------------------------
# In-memory test DB setup
# ---------------------------------------------------------------------------

@pytest.fixture()
def test_db():
    """Create an in-memory SQLite database with all tables."""
    from backend.models.agent_proposals import AgentProposal  # noqa: F401 — registers table on Base

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    db = db_session()
    yield db
    db.close()


@pytest.fixture()
def monkeypatch_session_local(monkeypatch, test_db):
    """Monkeypatch SessionLocal to return the test database session."""
    mock = MagicMock(return_value=test_db)
    monkeypatch.setattr("backend.shared.db.SessionLocal", mock)
    monkeypatch.setattr("backend.agent.tools.portfolio_tools.SessionLocal", mock)
    monkeypatch.setattr("backend.agent.proposals.SessionLocal", mock)
    return mock


@pytest.fixture()
def test_user_id():
    return "test-user-001"


@pytest.fixture()
def test_portfolio_id(test_db, test_user_id):
    from backend.models import VirtualPortfolio

    p = VirtualPortfolio(
        id="test-portfolio-001",
        user_id=test_user_id,
        name="Test Portfolio",
        initial_capital=100000.0,
        current_cash=100000.0,
    )
    test_db.add(p)
    test_db.commit()
    test_db.refresh(p)
    return p.id


@pytest.fixture()
def test_watchlist_id(test_db, test_user_id):
    from backend.models import WatchlistORM

    w = WatchlistORM(
        id="test-watchlist-001",
        user_id=test_user_id,
        name="Test Watchlist",
        symbols_json=["AAPL", "GOOG"],
    )
    test_db.add(w)
    test_db.commit()
    test_db.refresh(w)
    return w.id


# ---------------------------------------------------------------------------
# Core CRUD tests
# ---------------------------------------------------------------------------

def test_create_proposal(test_db, test_user_id):
    from backend.agent.proposals import create_proposal

    result = create_proposal(
        test_db,
        user_id=test_user_id,
        run_id="run-123",
        type="paper_order",
        payload={"symbol": "NSE:RELIANCE", "side": "buy", "quantity": 10},
        summary="Buy RELIANCE",
        rationale="Strong momentum",
    )

    assert result["type"] == "paper_order"
    assert result["status"] == "pending"
    assert result["summary"] == "Buy RELIANCE"
    assert result["rationale"] == "Strong momentum"
    assert result["run_id"] == "run-123"
    assert result["payload"]["symbol"] == "NSE:RELIANCE"
    assert "proposal_id" in result
    assert "created_at" in result
    assert "expires_at" in result


def test_list_proposals_filter(test_db, test_user_id):
    from backend.agent.proposals import create_proposal, list_proposals

    create_proposal(test_db, test_user_id, "run-1", "paper_order", {}, "A", "A")
    create_proposal(test_db, test_user_id, "run-2", "alert", {}, "B", "B")
    create_proposal(test_db, "other-user", "run-3", "watchlist_add", {}, "C", "C")

    all_items = list_proposals(test_db, test_user_id)
    assert len(all_items) == 2

    pending_items = list_proposals(test_db, test_user_id, status="pending")
    assert len(pending_items) == 2

    none_items = list_proposals(test_db, test_user_id, status="confirmed")
    assert len(none_items) == 0


def test_reject_proposal(test_db, test_user_id):
    from backend.agent.proposals import create_proposal, reject_proposal

    p = create_proposal(test_db, test_user_id, "run-1", "paper_order", {}, "A", "A")
    result = reject_proposal(test_db, test_user_id, p["proposal_id"])

    assert result["status"] == "rejected"
    assert result["id"] == p["proposal_id"]


def test_reject_nonexistent(test_db, test_user_id):
    from backend.agent.proposals import reject_proposal

    with pytest.raises(ValueError, match="not_found"):
        reject_proposal(test_db, test_user_id, "nonexistent-id")


# ---------------------------------------------------------------------------
# Expire stale tests
# ---------------------------------------------------------------------------

def test_expire_stale_expires_pending(test_db, test_user_id):
    from backend.agent.proposals import expire_stale

    from backend.models.agent_proposals import AgentProposal

    p = AgentProposal(
        id="stale-001",
        user_id=test_user_id,
        type="paper_order",
        payload={},
        summary="Stale",
        rationale="Old",
        status="pending",
        created_at=datetime.utcnow() - timedelta(hours=25),
        expires_at=datetime.utcnow() - timedelta(hours=1),
    )
    test_db.add(p)
    test_db.commit()

    count = expire_stale(test_db)
    assert count >= 1

    stale_row = test_db.query(AgentProposal).filter(AgentProposal.id == "stale-001").first()
    assert stale_row.status == "expired"


def test_expire_stale_skips_confirmed(test_db, test_user_id):
    from backend.agent.proposals import create_proposal, expire_stale

    create_proposal(test_db, test_user_id, "run-1", "paper_order", {}, "A", "A")
    count = expire_stale(test_db)
    assert count == 0


# ---------------------------------------------------------------------------
# Confirm paper_order tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_confirm_paper_order(test_db, test_user_id, test_portfolio_id):
    from backend.agent.proposals import create_proposal, confirm_proposal
    from backend.models import VirtualOrder

    p = create_proposal(
        test_db,
        test_user_id,
        "run-1",
        "paper_order",
        {
            "symbol": "NSE:RELIANCE",
            "side": "buy",
            "quantity": 10,
            "order_type": "market",
            "portfolio_id": test_portfolio_id,
        },
        "Buy RELIANCE",
        "Momentum",
    )

    # Mock paper engine so confirm doesn't fail
    mock_engine = MagicMock()
    mock_engine.maybe_fill_market_order_now = AsyncMock(return_value=None)
    import backend.agent.proposals as prop_mod
    with patch.object(prop_mod, "get_paper_engine", return_value=mock_engine):
        result = await confirm_proposal(test_db, test_user_id, p["proposal_id"])

    assert result["status"] == "confirmed"
    assert "order_id" in result["result"]
    assert result["result"]["symbol"] == "NSE:RELIANCE"

    order = test_db.query(VirtualOrder).filter(VirtualOrder.id == result["result"]["order_id"]).first()
    assert order is not None
    assert order.side == "buy"


@pytest.mark.asyncio
async def test_confirm_paper_order_creates_default_book_when_none(test_db, test_user_id):
    from backend.agent.proposals import create_proposal, confirm_proposal

    p = create_proposal(
        test_db,
        test_user_id,
        "run-1",
        "paper_order",
        {"symbol": "NSE:RELIANCE", "side": "buy", "quantity": 10},
        "Buy RELIANCE",
        "Momentum",
    )

    import backend.agent.proposals as prop_mod
    mock_engine = MagicMock()
    mock_engine.maybe_fill_market_order_now = AsyncMock(return_value=None)
    with patch.object(prop_mod, "get_paper_engine", return_value=mock_engine):
        result = await confirm_proposal(test_db, test_user_id, p["proposal_id"])
    # A user without a paper book gets a default one created on their first
    # confirmed paper order (they already approved the trade).
    from backend.models import VirtualOrder, VirtualPortfolio

    assert result["status"] == "confirmed", result
    book = test_db.query(VirtualPortfolio).filter(VirtualPortfolio.user_id == test_user_id).first()
    assert book is not None and book.name == "Agent Paper Book"
    assert test_db.query(VirtualOrder).filter(VirtualOrder.portfolio_id == book.id).count() == 1


# ---------------------------------------------------------------------------
# Confirm alert tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_confirm_alert(test_db, test_user_id):
    from backend.agent.proposals import create_proposal, confirm_proposal

    p = create_proposal(
        test_db,
        test_user_id,
        "run-1",
        "alert",
        {
            "symbol": "NSE:TCS",
            "condition_type": "price_above",
            "threshold": 3000,
        },
        "Alert TCS above 3000",
        "Watch this level",
    )

    result = await confirm_proposal(test_db, test_user_id, p["proposal_id"])

    assert result["status"] == "confirmed"
    assert "alert_id" in result["result"]
    assert result["result"]["status"] == "created"


# ---------------------------------------------------------------------------
# Confirm watchlist_add tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_confirm_watchlist_add(test_db, test_user_id, test_watchlist_id):
    from backend.agent.proposals import create_proposal, confirm_proposal

    p = create_proposal(
        test_db,
        test_user_id,
        "run-1",
        "watchlist_add",
        {
            "symbol": "NSE:INFY",
            "watchlist_id": test_watchlist_id,
        },
        "Add INFY",
        "New pick",
    )

    result = await confirm_proposal(test_db, test_user_id, p["proposal_id"])

    assert result["status"] == "confirmed"
    assert result["result"]["symbol"] == "NSE:INFY"
    assert result["result"]["total_symbols"] == 3


@pytest.mark.asyncio
async def test_confirm_watchlist_add_no_watchlist(test_db, test_user_id):
    from backend.agent.proposals import create_proposal, confirm_proposal

    p = create_proposal(
        test_db,
        test_user_id,
        "run-1",
        "watchlist_add",
        {"symbol": "NSE:INFY", "watchlist_id": "nonexistent-wl"},
        "Add INFY",
        "New pick",
    )

    result = await confirm_proposal(test_db, test_user_id, p["proposal_id"])
    # Execution failure converts to "failed" status rather than raising
    assert result["status"] == "failed"
    assert "error" in result["result"]


# ---------------------------------------------------------------------------
# Confirm edge cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_confirm_nonexistent_proposal(test_db, test_user_id):
    from backend.agent.proposals import confirm_proposal

    with pytest.raises(ValueError, match="not_found"):
        await confirm_proposal(test_db, test_user_id, "nonexistent")


@pytest.mark.asyncio
async def test_confirm_rejected_proposal(test_db, test_user_id):
    from backend.agent.proposals import create_proposal, confirm_proposal, reject_proposal

    p = create_proposal(test_db, test_user_id, "run-1", "paper_order", {}, "A", "A")
    reject_proposal(test_db, test_user_id, p["proposal_id"])

    with pytest.raises(ValueError, match="not_pending"):
        await confirm_proposal(test_db, test_user_id, p["proposal_id"])


# ---------------------------------------------------------------------------
# propose_* tools (handler tests via monkeypatched SessionLocal)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_propose_paper_order_tool(monkeypatch_session_local, test_user_id):
    from backend.agent.proposals import proposal_tool_specs

    specs = proposal_tool_specs(test_user_id, run_id="run-999")
    tool_map = {s.name: s for s in specs}

    assert "propose_paper_order" in tool_map
    handler = tool_map["propose_paper_order"].handler

    result = await handler({
        "symbol": "NSE:RELIANCE",
        "side": "buy",
        "quantity": 10,
        "rationale": "Strong momentum",
    })

    assert result["status"] == "pending"
    assert result["type"] == "paper_order"
    assert result["summary"] == "Paper BUY 10.0 NSE:RELIANCE (market)"


@pytest.mark.asyncio
async def test_propose_paper_order_invalid_side(monkeypatch_session_local, test_user_id):
    from backend.agent.proposals import proposal_tool_specs

    specs = proposal_tool_specs(test_user_id, run_id="run-999")
    tool_map = {s.name: s for s in specs}
    result = await tool_map["propose_paper_order"].handler({
        "symbol": "NSE:RELIANCE",
        "side": "hold",
        "quantity": 10,
        "rationale": "Invalid side",
    })

    assert "error" in result
    assert "side" in result["error"].lower()


@pytest.mark.asyncio
async def test_propose_paper_order_invalid_quantity(monkeypatch_session_local, test_user_id):
    from backend.agent.proposals import proposal_tool_specs

    specs = proposal_tool_specs(test_user_id, run_id="run-999")
    tool_map = {s.name: s for s in specs}
    result = await tool_map["propose_paper_order"].handler({
        "symbol": "NSE:RELIANCE",
        "side": "buy",
        "quantity": -5,
        "rationale": "Invalid qty",
    })

    assert "error" in result
    assert "quantity" in result["error"].lower()


@pytest.mark.asyncio
async def test_propose_alert_tool(monkeypatch_session_local, test_user_id):
    from backend.agent.proposals import proposal_tool_specs

    specs = proposal_tool_specs(test_user_id, run_id="run-999")
    tool_map = {s.name: s for s in specs}
    result = await tool_map["propose_alert"].handler({
        "symbol": "NSE:TCS",
        "condition_type": "price_above",
        "threshold": 3000,
        "rationale": "Support level",
    })

    assert result["status"] == "pending"
    assert result["type"] == "alert"
    assert "Alert NSE:TCS" in result["summary"]


@pytest.mark.asyncio
async def test_propose_alert_invalid_condition(monkeypatch_session_local, test_user_id):
    from backend.agent.proposals import proposal_tool_specs

    specs = proposal_tool_specs(test_user_id, run_id="run-999")
    tool_map = {s.name: s for s in specs}
    result = await tool_map["propose_alert"].handler({
        "symbol": "NSE:TCS",
        "condition_type": "volume_surge",
        "threshold": 100,
        "rationale": "Invalid condition",
    })

    assert "error" in result
    assert "condition_type" in result["error"].lower()


@pytest.mark.asyncio
async def test_propose_watchlist_add_tool(monkeypatch_session_local, test_user_id):
    from backend.agent.proposals import proposal_tool_specs

    specs = proposal_tool_specs(test_user_id, run_id="run-999")
    tool_map = {s.name: s for s in specs}
    result = await tool_map["propose_watchlist_add"].handler({
        "symbol": "NSE:INFY",
        "rationale": "New pick",
    })

    assert result["status"] == "pending"
    assert result["type"] == "watchlist_add"
    assert "INFY" in result["summary"]


@pytest.mark.asyncio
async def test_propose_watchlist_add_empty_symbol(monkeypatch_session_local, test_user_id):
    from backend.agent.proposals import proposal_tool_specs

    specs = proposal_tool_specs(test_user_id, run_id="run-999")
    tool_map = {s.name: s for s in specs}
    result = await tool_map["propose_watchlist_add"].handler({
        "symbol": "",
        "rationale": "Empty symbol",
    })

    assert "error" in result
    assert "symbol" in result["error"].lower()


# ---------------------------------------------------------------------------
# portfolio_tool_specs verification
# ---------------------------------------------------------------------------

def test_portfolio_tool_specs_returns_six(test_user_id):
    from backend.agent.tools.portfolio_tools import portfolio_tool_specs

    specs = portfolio_tool_specs(test_user_id)
    names = [s.name for s in specs]

    expected = [
        "get_portfolio",
        "get_paper_positions",
        "get_watchlists",
        "get_alerts",
        "get_upcoming_events",
        "get_provider_status",
    ]
    assert names == expected


def test_portfolio_tools_are_read_only():
    from backend.agent.tools.portfolio_tools import portfolio_tool_specs

    specs = portfolio_tool_specs("any-user")
    for spec in specs:
        assert spec.read_only is True
        assert spec.write_class == "none"


# ---------------------------------------------------------------------------
# propose_* tool specs
# ---------------------------------------------------------------------------

def test_proposal_tool_specs_returns_three():
    from backend.agent.proposals import proposal_tool_specs

    specs = [s.name for s in proposal_tool_specs("any-user")]
    assert "propose_paper_order" in specs
    assert "propose_alert" in specs
    assert "propose_watchlist_add" in specs


# ---------------------------------------------------------------------------
# API route tests (FastAPI TestClient)
# ---------------------------------------------------------------------------

@pytest.fixture()
def _build_proposal_client(monkeypatch):
    """Build a TestClient for the proposal routes (no DB queries)."""
    from unittest.mock import MagicMock

    from backend.auth.deps import get_current_user
    from backend.api.routes.agent_proposals import router
    from backend.api.deps import get_db as real_get_db

    app = FastAPI()

    # Mock auth
    mock_user = type("U", (), {"id": "test-user-001"})()
    app.dependency_overrides[get_current_user] = lambda: mock_user

    # Create query mock that returns None for first()
    def make_query_mock():
        q = MagicMock()
        q.filter.return_value.order_by.return_value.first.return_value = None
        q.filter.return_value.order_by.return_value.all.return_value = []
        q.filter.return_value.first.return_value = None
        q.filter.return_value.all.return_value = []
        return q

    mock_db = MagicMock()
    mock_db.query.side_effect = lambda *a, **k: make_query_mock()
    app.dependency_overrides[real_get_db] = lambda: mock_db

    app.include_router(router)

    return TestClient(app)


def test_api_list_proposals_returns_200(_build_proposal_client):
    client = _build_proposal_client
    resp = client.get("/agent/proposals")
    assert resp.status_code == 200
    assert "items" in resp.json()


def test_api_reject_returns_404(_build_proposal_client):
    """Reject route is sync and handles not found gracefully."""
    client = _build_proposal_client
    resp = client.post("/agent/proposals/nonexistent-id/reject")
    assert resp.status_code in (404, 409)


# ---------------------------------------------------------------------------
# Playbook integration
# ---------------------------------------------------------------------------

def test_playbook_has_action_discipline():
    from backend.agent.playbook import ACTION_DISCIPLINE

    assert "propose" in ACTION_DISCIPLINE.lower()
    assert "confirm" in ACTION_DISCIPLINE.lower()
    assert "rationale" in ACTION_DISCIPLINE.lower()


def test_playbook_updates_system_prompt():
    from backend.agent.playbook import GENERALIST_SYSTEM_PROMPT

    assert "propose" in GENERALIST_SYSTEM_PROMPT.lower()
    assert "ACTION_DISCIPLINE" not in GENERALIST_SYSTEM_PROMPT


def test_playbook_read_only_notice_updated():
    from backend.agent.playbook import READ_ONLY_NOTICE

    assert "propose" in READ_ONLY_NOTICE.lower() or "confirm" in READ_ONLY_NOTICE.lower()


# ---------------------------------------------------------------------------
# AgentProposal model
# ---------------------------------------------------------------------------

def test_agent_proposal_model_fields(test_db):
    from backend.models.agent_proposals import AgentProposal

    p = AgentProposal(
        id="model-test-001",
        user_id="test-user-001",
        run_id="run-1",
        type="paper_order",
        payload={"symbol": "NSE:RELIANCE"},
        summary="Test",
        rationale="Test rationale",
        status="pending",
    )
    test_db.add(p)
    test_db.commit()

    fetched = test_db.query(AgentProposal).filter(AgentProposal.id == "model-test-001").first()
    assert fetched is not None
    assert fetched.user_id == "test-user-001"
    assert fetched.status == "pending"
    assert fetched.created_at is not None
    assert fetched.expires_at is not None


def test_agent_proposal_expiry_default_24h(test_db):
    from backend.models.agent_proposals import AgentProposal

    p = AgentProposal(
        id="model-test-002",
        user_id="test-user-001",
        type="paper_order",
        payload={},
        summary="Test",
        rationale="Test rationale",
    )
    test_db.add(p)
    test_db.commit()

    now = datetime.now()
    delta = p.expires_at - p.created_at
    assert 23 * 3600 <= delta.total_seconds() <= 25 * 3600


# ---------------------------------------------------------------------------
# Proposal result on confirm
# ---------------------------------------------------------------------------

def test_proposal_result_on_confirm(test_db, test_user_id):
    from backend.agent.proposals import create_proposal, list_proposals

    p = create_proposal(test_db, test_user_id, "run-1", "alert", {
        "symbol": "NSE:TCS",
        "condition_type": "price_above",
        "threshold": 3000,
    }, "Alert TCS", "Watch level")

    import asyncio

    async def _confirm():
        from backend.agent.proposals import confirm_proposal
        return await confirm_proposal(test_db, test_user_id, p["proposal_id"])

    result = asyncio.run(_confirm())
    assert result["status"] == "confirmed"

    rows = list_proposals(test_db, test_user_id)
    assert len(rows) == 1
    assert rows[0]["status"] == "confirmed"
    assert rows[0]["result"]["alert_id"] is not None


def test_proposal_result_on_reject(test_db, test_user_id):
    from backend.agent.proposals import create_proposal, reject_proposal, list_proposals

    p = create_proposal(test_db, test_user_id, "run-1", "paper_order", {}, "A", "A")
    reject_proposal(test_db, test_user_id, p["proposal_id"])

    rows = list_proposals(test_db, test_user_id)
    assert len(rows) == 1
    assert rows[0]["status"] == "rejected"
    assert rows[0]["result"] is None


# ---------------------------------------------------------------------------
# Cross-user isolation
# ---------------------------------------------------------------------------

def test_proposals_isolated_by_user(test_db):
    from backend.agent.proposals import create_proposal, list_proposals

    user_a = "user-a"
    user_b = "user-b"

    create_proposal(test_db, user_a, "run-1", "paper_order", {}, "A", "A")
    create_proposal(test_db, user_a, "run-2", "paper_order", {}, "B", "B")
    create_proposal(test_db, user_b, "run-3", "paper_order", {}, "C", "C")

    a_rows = list_proposals(test_db, user_a)
    b_rows = list_proposals(test_db, user_b)

    assert len(a_rows) == 2
    assert len(b_rows) == 1

    for row in a_rows:
        assert row["user_id"] == user_a
    for row in b_rows:
        assert row["user_id"] == user_b