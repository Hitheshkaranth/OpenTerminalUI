"""Adversarial integration checks for opt-in paper trade risk enforcement."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def book(monkeypatch):
    from backend.agent import proposals, trade_preflight
    from backend.agent.tools import action_tools
    from backend.models import VirtualPortfolio
    from backend.paper_trading.service import PaperTradingEngine
    from backend.shared.db import Base

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    db.add_all([
        VirtualPortfolio(id="book", user_id="owner", name="Owned", initial_capital=10000, current_cash=10000),
        VirtualPortfolio(id="foreign", user_id="other", name="Foreign", initial_capital=1000000, current_cash=1000000),
    ])
    db.commit()
    trade_preflight.set_risk_policy(db, "owner", {"enabled": True})
    monkeypatch.setattr(proposals, "SessionLocal", factory)
    monkeypatch.setattr(action_tools, "SessionLocal", factory)
    marks = {"price": 100.0, "quality": "delayed", "as_of": datetime.now(timezone.utc).isoformat()}

    async def quotes(symbols):
        return ({symbol: marks["price"] for symbol in symbols}, {
            symbol: {"source": "fixture", "quality": marks["quality"], "as_of": marks["as_of"]}
            for symbol in symbols
        })

    monkeypatch.setattr(action_tools, "_mark_prices", quotes)
    monkeypatch.setattr(proposals, "get_paper_engine", lambda: PaperTradingEngine())
    yield db, factory, marks
    db.close()
    engine.dispose()


def policy(book, **overrides):
    from backend.agent.trade_preflight import set_risk_policy

    return set_risk_policy(book[0], "owner", {"enabled": True, **overrides})


async def propose(**overrides):
    from backend.agent.proposals import proposal_tool_specs

    handler = next(spec.handler for spec in proposal_tool_specs("owner") if spec.name == "propose_paper_order")
    return await handler({"symbol": "NSE:TCS", "side": "buy", "quantity": 5,
                          "portfolio_id": "book", "rationale": "Reviewed idea", "stop_price": 90,
                          **overrides})


def assert_denied(result):
    assert "proposal_id" not in result, result
    assert "error" in result or result.get("ok") is False, result


def assert_no_fills(db):
    from backend.models import VirtualOrder, VirtualTrade

    db.expire_all()
    assert db.query(VirtualOrder).count() == 0
    assert db.query(VirtualTrade).count() == 0


def test_risk_policy_is_opt_in_persisted_and_scoped(book):
    from backend.agent.trade_preflight import get_risk_policy

    db, factory, _ = book
    assert get_risk_policy(db, "unconfigured")["enabled"] is False
    assert get_risk_policy(db, "owner")["enabled"] is True
    policy(book, max_position_pct=15)
    with factory() as other_session:
        assert get_risk_policy(other_session, "owner")["max_position_pct"] == 15
        assert get_risk_policy(other_session, "other")["enabled"] is False


@pytest.mark.parametrize("override", [
    {"enabled": "true"}, {"max_position_pct": 0}, {"max_position_pct": 101},
    {"max_position_pct": True}, {"risk_budget_pct": float("nan")},
    {"risk_budget_pct": -1}, {"require_stop": "false"},
    {"max_quote_drift_pct": float("inf")}, {"max_quote_age_seconds": -1},
])
def test_invalid_policy_cannot_overwrite_valid_policy(book, override):
    from backend.agent.trade_preflight import get_risk_policy, set_risk_policy

    with pytest.raises((ValueError, TypeError)):
        set_risk_policy(book[0], "owner", {"enabled": True, **override})
    assert get_risk_policy(book[0], "owner")["max_position_pct"] == 20


@pytest.mark.asyncio
@pytest.mark.parametrize("identifier", ["foreign", "missing"])
async def test_explicit_foreign_or_missing_book_never_falls_back(book, identifier):
    from backend.models import VirtualPortfolio
    from backend.models.agent_proposals import AgentProposal

    assert_denied(await propose(portfolio_id=identifier))
    db = book[0]
    assert db.query(AgentProposal).count() == 0
    assert db.query(VirtualPortfolio).count() == 2
    assert_no_fills(db)


@pytest.mark.asyncio
@pytest.mark.parametrize("identifier", ["", True, 42, [], {}, ["book"]])
async def test_invalid_explicit_book_identifier_never_falls_back_or_raises(book, identifier):
    assert_denied(await propose(portfolio_id=identifier))
    assert_no_fills(book[0])


@pytest.mark.asyncio
async def test_inactive_book_is_rejected(book):
    from backend.models import VirtualPortfolio

    db = book[0]
    db.get(VirtualPortfolio, "book").is_active = False
    db.commit()
    assert_denied(await propose())
    assert_no_fills(db)


@pytest.mark.asyncio
@pytest.mark.parametrize("cost_basis", [-1, float("inf")])
async def test_invalid_stored_cost_basis_cannot_corrupt_guarded_ledger(book, cost_basis):
    from backend.models import VirtualPosition

    db = book[0]
    db.add(VirtualPosition(portfolio_id="book", symbol="NSE:TCS", quantity=10, avg_entry_price=cost_basis))
    db.commit()
    assert_denied(await propose(side="sell", quantity=1, stop_price=None))
    assert_no_fills(db)


@pytest.mark.asyncio
async def test_missing_default_book_is_not_implicitly_created(book):
    from backend.models import VirtualPortfolio

    db = book[0]
    db.delete(db.get(VirtualPortfolio, "book"))
    db.commit()
    assert_denied(await propose(portfolio_id=None))
    assert db.query(VirtualPortfolio).count() == 1
    assert_no_fills(db)


@pytest.mark.asyncio
async def test_policy_change_during_quote_fetch_requires_new_review(book, monkeypatch):
    from backend.agent.tools import action_tools
    from backend.agent.trade_preflight import set_risk_policy

    original = action_tools._mark_prices

    async def quotes_with_policy_change(symbols):
        quotes = await original(symbols)
        set_risk_policy(book[0], "owner", {"risk_budget_pct": .1})
        return quotes

    monkeypatch.setattr(action_tools, "_mark_prices", quotes_with_policy_change)
    assert_denied(await propose())
    assert_no_fills(book[0])


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [
    {"stop_price": None}, {"stop_price": 100}, {"stop_price": 110},
    {"stop_price": True}, {"quantity": 11},
    {"order_type": "limit", "limit_price": 90},
    {"order_type": "sl", "sl_price": 110},
])
async def test_unfunded_risk_or_unsupported_orders_never_proposed(book, changes):
    assert_denied(await propose(**changes))
    assert_no_fills(book[0])


@pytest.mark.asyncio
async def test_concentration_uses_post_fee_equity(book):
    policy(book, require_stop=False)
    assert_denied(await propose(quantity=20, stop_price=None))
    accepted = await propose(quantity=19, stop_price=None)
    assert accepted["status"] == "pending", accepted
    assert_no_fills(book[0])


@pytest.mark.asyncio
async def test_cash_includes_fees_and_slippage(book):
    policy(book, require_stop=False, max_position_pct=100)
    assert_denied(await propose(quantity=100, stop_price=None))
    accepted = await propose(quantity=99, stop_price=None)
    assert accepted["status"] == "pending", accepted


@pytest.mark.asyncio
@pytest.mark.parametrize("quality,age", [("synthetic", 0), ("unavailable", 0), ("delayed", 7200)])
async def test_bad_or_stale_quote_cannot_create_trade_proposal(book, quality, age):
    book[2]["quality"] = quality
    book[2]["as_of"] = (datetime.now(timezone.utc) - timedelta(seconds=age)).isoformat()
    assert_denied(await propose())
    assert_no_fills(book[0])


@pytest.mark.asyncio
async def test_pending_proposals_reserve_stop_risk_and_release_on_rejection(book):
    from backend.agent.proposals import reject_proposal

    first = await propose(quantity=6)
    assert first["status"] == "pending", first
    assert_denied(await propose(quantity=5))
    reject_proposal(book[0], "owner", first["proposal_id"])
    assert (await propose(quantity=5))["status"] == "pending"
    assert_no_fills(book[0])


@pytest.mark.asyncio
async def test_pending_proposals_reserve_cash(book):
    policy(book, require_stop=False, max_position_pct=100)
    assert (await propose(quantity=60, stop_price=None))["status"] == "pending"
    assert_denied(await propose(quantity=50, stop_price=None))


@pytest.mark.asyncio
async def test_pending_proposals_reserve_position_exposure(book):
    policy(book, require_stop=False)
    assert (await propose(quantity=11, stop_price=None))["status"] == "pending"
    assert_denied(await propose(quantity=10, stop_price=None))


@pytest.mark.asyncio
async def test_pending_orders_block_new_risk_proposals(book):
    from backend.models import VirtualOrder

    db = book[0]
    db.add(VirtualOrder(portfolio_id="book", symbol="NSE:INFY", side="buy", order_type="limit",
                        quantity=1, limit_price=90, status="pending"))
    db.commit()
    assert_denied(await propose())
    assert db.query(VirtualOrder).count() == 1


@pytest.mark.asyncio
async def test_pending_sell_reserves_available_quantity(book):
    from backend.models import VirtualPosition

    db = book[0]
    db.add(VirtualPosition(portfolio_id="book", symbol="NSE:TCS", quantity=10, avg_entry_price=50))
    db.commit()
    assert (await propose(side="sell", quantity=6, stop_price=None))["status"] == "pending"
    assert_denied(await propose(side="sell", quantity=5, stop_price=None))


@pytest.mark.asyncio
async def test_sell_commission_larger_than_proceeds_cannot_be_silently_waived(book):
    from backend.models import VirtualPosition

    db = book[0]
    db.add(VirtualPosition(portfolio_id="book", symbol="NSE:TCS", quantity=10, avg_entry_price=50))
    db.commit()
    assert_denied(await propose(side="sell", quantity=1, stop_price=None, commission=1000))
    assert_no_fills(db)


@pytest.mark.asyncio
async def test_full_sale_preserves_realized_cost_basis_after_position_closes(book):
    from backend.agent.proposals import confirm_proposal
    from backend.models import VirtualPortfolio, VirtualPosition, VirtualTrade

    db = book[0]
    db.add(VirtualPosition(portfolio_id="book", symbol="NSE:TCS", quantity=10, avg_entry_price=50))
    db.commit()
    proposed = await propose(side="sell", quantity=10, stop_price=None)
    assert proposed["status"] == "pending", proposed
    result = await confirm_proposal(db, "owner", proposed["proposal_id"])
    assert result["status"] == "confirmed", result
    db.expire_all()
    assert db.query(VirtualPosition).one().quantity == 0
    trade = db.query(VirtualTrade).one()
    expected_fee = 10 * 99.95 * .0005
    assert trade.pnl_realized == pytest.approx((99.95 - 50) * 10 - expected_fee)
    assert db.get(VirtualPortfolio, "book").current_cash == pytest.approx(10000 + 999.5 - expected_fee)


@pytest.mark.asyncio
async def test_successful_confirmation_fills_once_and_preserves_audit_snapshot(book):
    from backend.agent.proposals import confirm_proposal
    from backend.models import VirtualOrder, VirtualPortfolio, VirtualPosition, VirtualTrade

    proposed = await propose()
    assert proposed["status"] == "pending", proposed
    preview = proposed["payload"]["preflight"]
    assert preview["portfolio_snapshot"]["cash"] == 10000
    assert preview["prices"]["NSE:TCS"] == 100
    assert preview["policy"]["enabled"] is True
    assert preview["quote_provenance"]["NSE:TCS"]["source"] == "fixture"
    assert_no_fills(book[0])
    result = await confirm_proposal(book[0], "owner", proposed["proposal_id"])
    assert result["status"] == "confirmed", result
    book[0].expire_all()
    order = book[0].query(VirtualOrder).one()
    assert order.status == "filled"
    assert order.quantity == 5
    assert book[0].query(VirtualPosition).one().quantity == 5
    assert book[0].query(VirtualTrade).count() == 1
    assert book[0].get(VirtualPortfolio, "book").current_cash < 9500
    with pytest.raises(ValueError, match="not_pending"):
        await confirm_proposal(book[0], "owner", proposed["proposal_id"])
    assert book[0].query(VirtualTrade).count() == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["cash", "position", "policy", "price"])
async def test_changed_snapshot_policy_or_quote_rejects_before_fills(book, change):
    from backend.agent.proposals import confirm_proposal
    from backend.models import VirtualPortfolio, VirtualPosition

    proposed = await propose()
    assert proposed["status"] == "pending", proposed
    db, _, marks = book
    if change == "cash":
        db.get(VirtualPortfolio, "book").current_cash -= 1
        db.commit()
    elif change == "position":
        db.add(VirtualPosition(portfolio_id="book", symbol="NSE:INFY", quantity=1, avg_entry_price=50))
        db.commit()
    elif change == "policy":
        policy(book, risk_budget_pct=.1)
    else:
        marks["price"] = 102
    result = await confirm_proposal(db, "owner", proposed["proposal_id"])
    assert result["status"] == "failed", result
    assert_no_fills(db)


@pytest.mark.asyncio
async def test_quote_within_drift_allowance_still_rechecks_stop_budget(book):
    from backend.agent.proposals import confirm_proposal

    proposed = await propose(quantity=9, stop_price=89)
    assert proposed["status"] == "pending", proposed
    book[2]["price"] = 100.5  # Within 1% drift, but refreshed stop loss exceeds 1% budget.
    result = await confirm_proposal(book[0], "owner", proposed["proposal_id"])
    assert result["status"] == "failed", result
    assert_no_fills(book[0])


@pytest.mark.asyncio
async def test_legacy_payload_without_preflight_cannot_bypass_enabled_policy(book):
    from backend.agent.proposals import confirm_proposal, create_proposal

    proposed = create_proposal(book[0], "owner", None, "paper_order", {
        "symbol": "NSE:TCS", "side": "buy", "quantity": 5, "portfolio_id": "book", "stop_price": 90,
    }, "Legacy trade", "Review")
    result = await confirm_proposal(book[0], "owner", proposed["proposal_id"])
    assert result["status"] == "failed", result
    assert_no_fills(book[0])


@pytest.mark.asyncio
async def test_rebalance_tool_cannot_bypass_enabled_risk_policy(book):
    from backend.agent.tools.action_tools import propose_rebalance
    from backend.models.agent_proposals import AgentProposal

    result = await propose_rebalance({"portfolio_id": "book", "target_weights": {"NSE:TCS": 1},
                                      "rationale": "Concentrate entire book"}, "owner")
    assert_denied(result)
    assert book[0].query(AgentProposal).count() == 0
    assert_no_fills(book[0])


@pytest.mark.asyncio
async def test_old_rebalance_cannot_execute_after_enabling_risk_policy(book):
    from backend.agent.proposals import confirm_proposal, create_proposal

    proposed = create_proposal(book[0], "owner", None, "rebalance", {
        "portfolio_id": "book", "portfolio_snapshot": {"cash": 10000, "positions": {}},
        "deltas": [{"symbol": "NSE:TCS", "price_used": 100, "implied_delta_qty": 99}],
    }, "Old rebalance", "Before policy enabled")
    result = await confirm_proposal(book[0], "owner", proposed["proposal_id"])
    assert result["status"] == "failed", result
    assert_no_fills(book[0])


@pytest.mark.asyncio
async def test_fill_failure_rolls_back_every_trade_effect(book, monkeypatch):
    from backend.agent import proposals
    from backend.models import VirtualPortfolio, VirtualPosition
    from backend.paper_trading.service import PaperTradingEngine

    proposed = await propose()
    assert proposed["status"] == "pending", proposed

    class FailAfterFill(PaperTradingEngine):
        def _fill_order(self, db, order, market_price):
            super()._fill_order(db, order, market_price)
            db.flush()
            raise RuntimeError("Injected post-fill failure")

    monkeypatch.setattr(proposals, "get_paper_engine", lambda: FailAfterFill())
    result = await proposals.confirm_proposal(book[0], "owner", proposed["proposal_id"])
    assert result["status"] == "failed", result
    assert_no_fills(book[0])
    assert book[0].query(VirtualPosition).count() == 0
    assert book[0].get(VirtualPortfolio, "book").current_cash == 10000


@pytest.mark.asyncio
async def test_confirm_does_not_count_own_reservation_twice(book):
    from backend.agent.proposals import confirm_proposal

    proposed = await propose(quantity=9)
    assert proposed["status"] == "pending", proposed
    result = await confirm_proposal(book[0], "owner", proposed["proposal_id"])
    assert result["status"] == "confirmed", result


@pytest.mark.asyncio
async def test_second_stale_session_cannot_confirm_same_trade_again(book):
    from backend.agent.proposals import confirm_proposal
    from backend.models import VirtualTrade
    from backend.models.agent_proposals import AgentProposal

    proposed = await propose()
    with book[1]() as stale:
        assert stale.get(AgentProposal, proposed["proposal_id"]).status == "pending"
        assert (await confirm_proposal(book[0], "owner", proposed["proposal_id"]))["status"] == "confirmed"
        with pytest.raises(ValueError, match="not_pending"):
            await confirm_proposal(stale, "owner", proposed["proposal_id"])
    assert book[0].query(VirtualTrade).count() == 1


@pytest.mark.asyncio
async def test_changed_order_payload_requires_new_review(book):
    from backend.agent.proposals import confirm_proposal
    from backend.models.agent_proposals import AgentProposal

    proposed = await propose()
    db = book[0]
    row = db.get(AgentProposal, proposed["proposal_id"])
    row.payload = {**row.payload, "quantity": 6}
    db.commit()
    result = await confirm_proposal(db, "owner", proposed["proposal_id"])
    assert result["status"] == "failed", result
    assert_no_fills(db)


@pytest.mark.asyncio
async def test_expired_pending_proposal_releases_reservation(book):
    from backend.models.agent_proposals import AgentProposal

    first = await propose(quantity=6)
    db = book[0]
    row = db.get(AgentProposal, first["proposal_id"])
    row.expires_at = (datetime.now(timezone.utc) - timedelta(seconds=1)).replace(tzinfo=None)
    db.commit()
    assert (await propose(quantity=5))["status"] == "pending"


@pytest.mark.asyncio
async def test_engine_rejection_is_failed_with_no_order_committed(book, monkeypatch):
    from backend.agent import proposals
    from backend.paper_trading.service import PaperTradingEngine

    proposed = await propose()

    class RejectFill(PaperTradingEngine):
        def _fill_order(self, db, order, market_price):
            order.status = "rejected"

    monkeypatch.setattr(proposals, "get_paper_engine", lambda: RejectFill())
    result = await proposals.confirm_proposal(book[0], "owner", proposed["proposal_id"])
    assert result["status"] == "failed", result
    assert_no_fills(book[0])


def test_risk_policy_http_api_scopes_changes_to_authenticated_user(book, monkeypatch):
    from types import SimpleNamespace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api.deps import get_db
    from backend.api.routes.agent_proposals import router
    from backend.auth.deps import get_current_user

    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: book[0]
    identity = {"id": "owner"}
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=identity["id"])
    with TestClient(app) as client:
        assert client.get("/api/agent/risk-policy").json()["enabled"] is True
        response = client.put("/api/agent/risk-policy", json={"max_position_pct": 10})
        assert response.status_code == 200, response.text
        assert response.json()["max_position_pct"] == 10
        assert client.put("/api/agent/risk-policy", json={"user_id": "other", "enabled": False}).status_code == 422
        identity["id"] = "other"
        assert client.get("/api/agent/risk-policy").json()["enabled"] is False
        identity["id"] = "owner"
        assert client.get("/api/agent/risk-policy").json()["max_position_pct"] == 10
        app.dependency_overrides.pop(get_current_user)
        monkeypatch.setenv("E2E_DEV_AUTH", "0")
        assert client.get("/api/agent/risk-policy").status_code == 401
        assert client.put("/api/agent/risk-policy", json={"enabled": False}).status_code == 401
