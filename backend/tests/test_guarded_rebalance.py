"""Independent adversarial checks of reviewed, atomic guarded rebalances."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.agent import proposals, rebalance_preflight, trade_preflight
from backend.agent.tools import action_tools
from backend.models import VirtualOrder, VirtualPortfolio, VirtualPosition, VirtualTrade
from backend.models.agent_proposals import AgentProposal
from backend.paper_trading.service import PaperTradingEngine, risk_checked_fill
from backend.shared.db import Base


OLD = "NASDAQ:AAA"
NEW = "NASDAQ:BBB"
THIRD = "NASDAQ:CCC"
FOREIGN = "XETRA:SAP"


@pytest.fixture
def book(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    db.add_all([
        VirtualPortfolio(id="owned", user_id="owner", name="Owned", base_currency="USD", initial_capital=10000, current_cash=5000),
        VirtualPortfolio(id="foreign", user_id="someone-else", name="Not owned", base_currency="USD", initial_capital=10000, current_cash=10000),
        VirtualPosition(portfolio_id="owned", symbol=OLD, quantity=50, avg_entry_price=80, side="long"),
    ])
    db.commit()
    trade_preflight.set_risk_policy(db, "owner", {"enabled": True, "max_position_pct": 60, "risk_budget_pct": 5})
    state = {"prices": {OLD: 100, NEW: 100, THIRD: 100, FOREIGN: 100, "EURUSD=X": 1.25},
             "as_of": datetime.now(timezone.utc).isoformat(), "fx_as_of": datetime.now(timezone.utc).isoformat(),
             "quality": "delayed"}

    async def marked(symbols):
        prices = {symbol: state["prices"][symbol] for symbol in symbols if symbol in state["prices"]}
        sources = {symbol: {"source": "offline-fixture", "quality": state["quality"],
                            "as_of": state["fx_as_of"] if symbol.endswith("=X") else state["as_of"]}
                   for symbol in prices}
        return prices, sources

    paper = PaperTradingEngine()
    monkeypatch.setattr(action_tools, "SessionLocal", factory)
    monkeypatch.setattr(action_tools, "_mark_prices", marked)
    monkeypatch.setattr(proposals, "get_paper_engine", lambda: paper)
    yield db, factory, state, paper
    db.close()
    engine.dispose()


async def propose(**changes):
    return await action_tools.propose_rebalance({"portfolio_id": "owned", "target_weights": {OLD: .5, NEW: .5},
                                                "risk_stops": {NEW: 99}, "rationale": "Reviewed diversification",
                                                **changes}, "owner")


def unchanged(db):
    db.expire_all()
    assert db.get(VirtualPortfolio, "owned").current_cash == 5000
    rows = db.query(VirtualPosition).filter_by(portfolio_id="owned").all()
    assert [(row.symbol, row.quantity, row.avg_entry_price) for row in rows] == [(OLD, 50, 80)]
    assert db.query(VirtualOrder).filter_by(portfolio_id="owned").count() == 0
    assert db.query(VirtualTrade).filter_by(portfolio_id="owned").count() == 0


def proposal_id(result):
    assert result["ok"] is True, result
    return result["data"]["proposal_id"]


@pytest.mark.asyncio
async def test_preview_is_pure_and_successful_confirmation_sells_first_matches_reviewed_cash(book):
    db, _, _, _ = book
    result = await propose()
    identifier = proposal_id(result)
    reviewed = result["data"]["risk_preflight"]
    assert reviewed["base_currency"] == "USD"
    assert reviewed["combined_stop_risk"] < 500
    unchanged(db)
    assert db.query(AgentProposal).filter_by(id=identifier).one().status == "pending"
    confirmed = await proposals.confirm_proposal(db, "owner", identifier)
    assert confirmed["status"] == "confirmed", confirmed
    assert [order["side"] for order in confirmed["result"]["orders"]] == ["sell", "buy"]
    db.expire_all()
    cash = db.get(VirtualPortfolio, "owned").current_cash
    assert cash == pytest.approx(reviewed["estimated_cash_after"], abs=1e-6)
    assert cash >= 0
    assert db.query(VirtualOrder).count() == db.query(VirtualTrade).count() == 2
    with pytest.raises(ValueError, match="not_pending"):
        await proposals.confirm_proposal(db, "owner", identifier)


@pytest.mark.asyncio
async def test_risk_budget_aggregates_buys_that_individually_fit(book):
    db = book[0]
    def payload(buys):
        return {"portfolio_id": "owned", "risk_stops": {NEW: 90, THIRD: 90},
                "portfolio_snapshot": {"cash": 5000, "positions": {OLD: 50}},
                "target_weights": {OLD: .3, NEW: .3, THIRD: .3},
                "deltas": [{"symbol": OLD, "implied_delta_qty": -20},
                           *[{"symbol": symbol, "implied_delta_qty": 30} for symbol in buys]]}

    for symbol in (NEW, THIRD):
        preview = await rebalance_preflight.preview_rebalance(db, "owner", payload([symbol]))
        assert preview["combined_stop_risk"] == 300
    with pytest.raises(ValueError, match="Combined.*risk"):
        await rebalance_preflight.preview_rebalance(db, "owner", payload([NEW, THIRD]))
    unchanged(db)


@pytest.mark.asyncio
@pytest.mark.parametrize("stops", [{}, {NEW: 100}, {NEW: -1}, {NEW: float("nan")}, {NEW: True}])
async def test_invalid_or_missing_hypothetical_buy_stop_cannot_create_proposal(book, stops):
    result = await propose(risk_stops=stops)
    assert result["ok"] is False
    assert book[0].query(AgentProposal).count() == 0
    unchanged(book[0])


@pytest.mark.asyncio
@pytest.mark.parametrize("identifier", ["missing", "foreign", "", [], {}, False])
async def test_explicit_invalid_or_unowned_portfolio_never_defaults_to_an_owned_book(book, identifier):
    result = await propose(portfolio_id=identifier)
    assert result["ok"] is False
    assert book[0].query(AgentProposal).count() == 0
    unchanged(book[0])


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["cash", "position", "policy", "quote", "stop", "quantity", "weights"])
async def test_changed_review_requires_new_confirmation_without_fills(book, change):
    db, _, state, _ = book
    identifier = proposal_id(await propose())
    row = db.get(AgentProposal, identifier)
    if change == "cash":
        db.get(VirtualPortfolio, "owned").current_cash += 1
    elif change == "position":
        db.query(VirtualPosition).filter_by(portfolio_id="owned", symbol=OLD).one().quantity += 1
    elif change == "policy":
        trade_preflight.set_risk_policy(db, "owner", {"max_position_pct": 59})
    elif change == "quote":
        state["prices"][NEW] = 102
    else:
        payload = dict(row.payload)
        if change == "stop":
            payload["risk_stops"] = {NEW: 98}
        elif change == "quantity":
            payload["deltas"] = [{**leg, "implied_delta_qty": leg["implied_delta_qty"] / 2} for leg in payload["deltas"]]
        else:
            payload["target_weights"] = {OLD: .51, NEW: .49}
        row.payload = payload
    db.commit()
    cash_before = db.get(VirtualPortfolio, "owned").current_cash
    positions_before = {p.symbol: p.quantity for p in db.query(VirtualPosition).filter_by(portfolio_id="owned")}
    confirmed = await proposals.confirm_proposal(db, "owner", identifier)
    assert confirmed["status"] == "failed", confirmed
    assert db.query(VirtualOrder).count() == db.query(VirtualTrade).count() == 0
    assert db.get(VirtualPortfolio, "owned").current_cash == cash_before
    assert {p.symbol: p.quantity for p in db.query(VirtualPosition).filter_by(portfolio_id="owned")} == positions_before


@pytest.mark.asyncio
async def test_failure_after_second_fill_rolls_back_both_legs_and_resets_sync_guard(book, monkeypatch):
    db, _, _, _ = book
    identifier = proposal_id(await propose())

    class InterruptedEngine(PaperTradingEngine):
        calls = 0

        def _fill_order(self, session, order, price):
            super()._fill_order(session, order, price)
            self.calls += 1
            if self.calls == 2:
                raise RuntimeError("Injected second leg interruption")

    paper = InterruptedEngine()
    monkeypatch.setattr(proposals, "get_paper_engine", lambda: paper)
    confirmed = await proposals.confirm_proposal(db, "owner", identifier)
    assert paper.calls == 2
    assert confirmed["status"] == "failed" and "Injected" in confirmed["result"]["error"]
    unchanged(db)
    assert risk_checked_fill.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["pending", "open", "partially_filled"])
async def test_any_unsettled_paper_order_blocks_rebalance_capacity(book, status):
    db = book[0]
    db.add(VirtualOrder(portfolio_id="owned", symbol=NEW, side="buy", order_type="limit", quantity=1, status=status))
    db.commit()
    result = await propose()
    assert result["ok"] is False
    assert db.query(AgentProposal).count() == 0
    assert db.query(VirtualOrder).count() == 1 and db.query(VirtualTrade).count() == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["paper_order", "rebalance"])
async def test_pending_proposals_block_guarded_rebalance(book, kind):
    db = book[0]
    db.add(AgentProposal(id="previous", user_id="owner", type=kind, payload={"portfolio_id": "owned"},
                        summary="Pending", rationale="Existing", status="pending",
                        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)))
    db.commit()
    result = await propose()
    assert result["ok"] is False
    assert db.query(AgentProposal).count() == 1
    unchanged(db)


@pytest.mark.asyncio
async def test_foreign_currency_rebalance_uses_dated_fx_and_fills_in_base_units(book):
    db = book[0]
    result = await propose(target_weights={OLD: .5, FOREIGN: .5}, risk_stops={FOREIGN: 99})
    identifier = proposal_id(result)
    reviewed = result["data"]["risk_preflight"]
    assert reviewed["prices"][FOREIGN] == 100
    assert reviewed["base_prices"][FOREIGN] == 125
    assert reviewed["fx"][FOREIGN]["pair"] == "EURUSD=X"
    assert reviewed["fx"][FOREIGN]["provenance"]["as_of"]
    confirmed = await proposals.confirm_proposal(db, "owner", identifier)
    assert confirmed["status"] == "confirmed", confirmed
    foreign = db.query(VirtualPosition).filter_by(portfolio_id="owned", symbol=FOREIGN).one()
    assert foreign.avg_entry_price == pytest.approx(125 * 1.0005)
    assert db.get(VirtualPortfolio, "owned").current_cash == pytest.approx(reviewed["estimated_cash_after"], abs=1e-6)


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["missing", "stale", "drift"])
async def test_missing_stale_or_changed_fx_cannot_execute_reviewed_rebalance(book, change):
    db, _, state, _ = book
    identifier = proposal_id(await propose(target_weights={OLD: .5, FOREIGN: .5}, risk_stops={FOREIGN: 99}))
    if change == "missing":
        state["prices"].pop("EURUSD=X")
    elif change == "stale":
        state["fx_as_of"] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    else:
        state["prices"]["EURUSD=X"] = 1.3
    confirmed = await proposals.confirm_proposal(db, "owner", identifier)
    assert confirmed["status"] == "failed"
    unchanged(db)


def test_central_fill_requires_matching_checked_fill_authorization(book):
    db, _, _, paper = book
    order = VirtualOrder(portfolio_id="owned", symbol=NEW, side="buy", order_type="market", quantity=1, status="pending")
    db.add(order)
    db.flush()
    paper._fill_order(db, order, 100)
    assert order.status == "rejected"
    assert db.get(VirtualPortfolio, "owned").current_cash == 5000
    assert db.query(VirtualTrade).count() == 0
    order.status = "pending"
    token = risk_checked_fill.set((order.id, 101))
    try:
        paper._fill_order(db, order, 100)
    finally:
        risk_checked_fill.reset(token)
    assert order.status == "rejected"
    assert db.query(VirtualTrade).count() == 0
