"""Independent adversarial checks of manual, delayed and FX paper fills."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def paper(monkeypatch):
    from backend.agent.tools import action_tools
    from backend.agent.trade_preflight import set_risk_policy
    from backend.api.routes import paper as routes
    from backend.models import VirtualPortfolio
    from backend.paper_trading import service
    from backend.shared.db import Base

    sql_engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(sql_engine)
    factory = sessionmaker(bind=sql_engine)
    db = factory()
    db.add_all([
        VirtualPortfolio(id="own", user_id="owner", name="Owned", base_currency="INR", initial_capital=100000, current_cash=100000),
        VirtualPortfolio(id="foreign", user_id="other", name="Other", base_currency="INR", initial_capital=100000, current_cash=100000),
    ])
    db.commit()
    set_risk_policy(db, "owner", {"enabled": True})
    now = datetime.now(timezone.utc).isoformat()
    marks = {"NSE:TCS": 100.0, "NASDAQ:AAPL": 100.0, "USDINR=X": 80.0}
    sources = {name: {"source": "fixture", "quality": "delayed", "as_of": now} for name in marks}

    async def quotes(symbols):
        return ({name: marks[name] for name in symbols if name in marks},
                {name: sources[name] for name in symbols if name in sources})

    engine = service.PaperTradingEngine()
    monkeypatch.setattr(action_tools, "_mark_prices", quotes)
    monkeypatch.setattr(routes, "get_paper_engine", lambda: engine)
    monkeypatch.setattr(service, "SessionLocal", factory)
    yield SimpleNamespace(db=db, factory=factory, engine=engine, marks=marks, sources=sources)
    db.close()
    sql_engine.dispose()


async def manual(paper, **kwargs):
    from backend.api.routes.paper import OrderCreateRequest, place_virtual_order

    payload = OrderCreateRequest(portfolio_id=kwargs.pop("portfolio_id", "own"), symbol=kwargs.pop("symbol", "NSE:TCS"),
        side=kwargs.pop("side", "buy"), quantity=kwargs.pop("quantity", 5),
        stop_price=kwargs.pop("stop_price", 90), **kwargs)
    return await place_virtual_order(payload, db=paper.db, current_user=SimpleNamespace(id="owner"))


def no_trades(paper):
    from backend.models import VirtualPortfolio, VirtualPosition, VirtualTrade

    paper.db.expire_all()
    assert paper.db.query(VirtualTrade).count() == 0
    assert paper.db.query(VirtualPosition).count() == 0
    assert paper.db.get(VirtualPortfolio, "own").current_cash == 100000


@pytest.mark.asyncio
async def test_manual_foreign_book_rejected_before_any_order_is_created(paper):
    from backend.models import VirtualOrder

    with pytest.raises(HTTPException) as failure:
        await manual(paper, portfolio_id="foreign")
    assert failure.value.status_code == 404
    assert paper.db.query(VirtualOrder).count() == 0
    no_trades(paper)


@pytest.mark.asyncio
async def test_manual_market_order_requires_stop_and_fills_after_real_preflight(paper):
    from backend.models import VirtualOrder, VirtualPosition

    with pytest.raises(HTTPException) as failure:
        await manual(paper, stop_price=None)
    assert failure.value.status_code == 422
    result = await manual(paper)
    assert result["status"] == "filled", result
    order = paper.db.get(VirtualOrder, result["id"])
    assert order.signal_metadata["risk_order"]["stop_price"] == 90
    assert order.signal_metadata["fill_preflight"]["base_currency"] == "INR"
    assert paper.db.query(VirtualPosition).one().quantity == 5


def test_direct_synchronous_fill_cannot_bypass_enabled_policy(paper):
    from backend.models import VirtualOrder

    order = VirtualOrder(portfolio_id="own", symbol="NSE:TCS", side="buy", order_type="market", quantity=5, status="pending")
    paper.db.add(order)
    paper.db.flush()
    paper.engine._fill_order(paper.db, order, 100)
    paper.db.commit()
    assert order.status == "rejected"
    assert "risk_rejection" in order.signal_metadata
    no_trades(paper)


def test_fill_authorization_is_bound_to_exact_order_and_price(paper):
    from backend.models import VirtualOrder
    from backend.paper_trading.service import risk_checked_fill

    order = VirtualOrder(portfolio_id="own", symbol="NSE:TCS", side="buy", order_type="market", quantity=5, status="pending")
    paper.db.add(order)
    paper.db.flush()
    token = risk_checked_fill.set((order.id, 99))
    try:
        paper.engine._fill_order(paper.db, order, 100)
    finally:
        risk_checked_fill.reset(token)
    paper.db.commit()
    assert order.status == "rejected"
    no_trades(paper)


@pytest.mark.asyncio
async def test_legacy_pending_order_cannot_fill_after_policy_is_enabled(paper):
    from backend.models import VirtualOrder

    order = VirtualOrder(portfolio_id="own", symbol="NSE:TCS", side="buy", order_type="limit", quantity=5,
                         limit_price=95, status="pending")
    paper.db.add(order)
    paper.db.commit()
    await paper.engine._evaluate_pending_orders({"symbol": "NSE:TCS", "ltp": 94})
    paper.db.expire_all()
    assert paper.db.get(VirtualOrder, order.id).status == "rejected"
    no_trades(paper)


@pytest.mark.asyncio
async def test_tick_only_triggers_limit_check_actual_quote_controls_fill(paper):
    from backend.models import VirtualOrder

    created = await manual(paper, order_type="limit", limit_price=95, stop_price=90)
    assert created["status"] == "pending"
    paper.marks["NSE:TCS"] = 97  # tick says crossed, but verified provider quote has not.
    await paper.engine._evaluate_pending_orders({"symbol": "NSE:TCS", "ltp": 94})
    paper.db.expire_all()
    assert paper.db.get(VirtualOrder, created["id"]).status == "pending"
    no_trades(paper)
    paper.marks["NSE:TCS"] = 94
    await paper.engine._evaluate_pending_orders({"symbol": "NSE:TCS", "ltp": 94})
    paper.db.expire_all()
    order = paper.db.get(VirtualOrder, created["id"])
    assert order.status == "filled"
    assert order.fill_price == pytest.approx(94 * 1.0005)


@pytest.mark.asyncio
async def test_limit_fill_never_exceeds_limit_after_slippage(paper):
    from backend.models import VirtualOrder, VirtualTrade

    created = await manual(paper, order_type="limit", limit_price=95, stop_price=90)
    paper.marks["NSE:TCS"] = 95
    await paper.engine._evaluate_pending_orders({"symbol": "NSE:TCS", "ltp": 95})
    paper.db.expire_all()
    order = paper.db.get(VirtualOrder, created["id"])
    if order.status == "filled":
        assert order.fill_price <= 95
    else:
        assert paper.db.query(VirtualTrade).count() == 0


@pytest.mark.asyncio
async def test_stop_gap_collar_is_applied_once_from_trigger_price(paper):
    from backend.models import VirtualOrder

    created = await manual(paper, order_type="sl", sl_price=105, stop_price=95)
    assert created["status"] == "pending"
    paper.marks["NSE:TCS"] = 106.5  # Above 105 * 1.01; a second collar would incorrectly admit this.
    await paper.engine._evaluate_pending_orders({"symbol": "NSE:TCS", "ltp": 106.5})
    paper.db.expire_all()
    assert paper.db.get(VirtualOrder, created["id"]).status == "rejected"
    no_trades(paper)


@pytest.mark.asyncio
async def test_delayed_fill_rechecks_current_cash_instead_of_review_snapshot(paper):
    from backend.models import VirtualOrder, VirtualPortfolio

    created = await manual(paper, order_type="limit", limit_price=95)
    paper.db.get(VirtualPortfolio, "own").current_cash = 1
    paper.db.commit()
    paper.marks["NSE:TCS"] = 94
    await paper.engine._evaluate_pending_orders({"symbol": "NSE:TCS", "ltp": 94})
    paper.db.expire_all()
    assert paper.db.get(VirtualOrder, created["id"]).status == "rejected"
    from backend.models import VirtualTrade
    assert paper.db.query(VirtualTrade).count() == 0
    assert paper.db.get(VirtualPortfolio, "own").current_cash == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_fx", ["missing", "stale", "synthetic", "zero"])
async def test_foreign_manual_trade_requires_valid_source_dated_fx(paper, bad_fx):
    from backend.models import VirtualOrder

    if bad_fx == "missing":
        paper.marks.pop("USDINR=X")
    elif bad_fx == "stale":
        paper.sources["USDINR=X"]["as_of"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    elif bad_fx == "synthetic":
        paper.sources["USDINR=X"]["quality"] = "synthetic"
    else:
        paper.marks["USDINR=X"] = 0
    with pytest.raises(HTTPException) as failure:
        await manual(paper, symbol="NASDAQ:AAPL", quantity=1)
    assert failure.value.status_code == 422
    assert paper.db.query(VirtualOrder).count() == 0
    no_trades(paper)


@pytest.mark.asyncio
async def test_foreign_fill_cash_cost_basis_and_realized_pnl_use_base_currency(paper):
    from backend.models import VirtualPortfolio, VirtualPosition, VirtualTrade

    bought = await manual(paper, symbol="NASDAQ:AAPL", quantity=1)
    assert bought["status"] == "filled", bought
    paper.db.expire_all()
    position = paper.db.query(VirtualPosition).one()
    entry = 100 * 80 * 1.0005
    entry_fee = entry * .0005
    assert position.avg_entry_price == pytest.approx(entry)
    assert paper.db.get(VirtualPortfolio, "own").current_cash == pytest.approx(100000 - entry - entry_fee)
    paper.marks["NASDAQ:AAPL"] = 110
    paper.marks["USDINR=X"] = 90
    sold = await manual(paper, symbol="NASDAQ:AAPL", side="sell", quantity=1, stop_price=None)
    assert sold["status"] == "filled", sold
    paper.db.expire_all()
    exit_price = 110 * 90 * .9995
    exit_fee = exit_price * .0005
    trade = paper.db.query(VirtualTrade).filter(VirtualTrade.side == "sell").one()
    assert trade.price == pytest.approx(exit_price)
    assert trade.pnl_realized == pytest.approx(exit_price - entry - exit_fee)
    assert paper.db.get(VirtualPortfolio, "own").current_cash == pytest.approx(100000 - entry - entry_fee + exit_price - exit_fee)


@pytest.mark.asyncio
async def test_fx_conversion_still_required_when_discretionary_policy_is_disabled(paper):
    from backend.agent.trade_preflight import set_risk_policy
    from backend.models import VirtualPosition

    set_risk_policy(paper.db, "owner", {"enabled": False})
    result = await manual(paper, symbol="NASDAQ:AAPL", quantity=1, stop_price=None)
    assert result["status"] == "filled", result
    assert paper.db.query(VirtualPosition).one().avg_entry_price == pytest.approx(8004)


@pytest.mark.asyncio
async def test_disabled_policy_does_not_turn_missing_fx_into_unconverted_fill(paper):
    from backend.agent.trade_preflight import set_risk_policy

    set_risk_policy(paper.db, "owner", {"enabled": False})
    paper.marks.pop("USDINR=X")
    result = await manual(paper, symbol="NASDAQ:AAPL", quantity=1, stop_price=None)
    assert result["status"] == "rejected", result
    no_trades(paper)


@pytest.mark.asyncio
async def test_domestic_valuation_uses_new_ticks_after_a_guarded_fill(paper):
    from backend.models import VirtualPortfolio, VirtualPosition

    assert (await manual(paper))["status"] == "filled"
    paper.engine._on_tick({"symbol": "NSE:TCS", "ltp": 120})
    portfolio = paper.db.get(VirtualPortfolio, "own")
    position = paper.db.query(VirtualPosition).one()
    assert paper.engine.mark_in_base(portfolio, position) == 120


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [True, False])
@pytest.mark.parametrize("side", ["buy", "sell"])
async def test_legacy_foreign_cost_basis_requires_reconciliation_before_new_fills(paper, enabled, side):
    from backend.agent.trade_preflight import set_risk_policy
    from backend.models import VirtualPortfolio, VirtualPosition, VirtualTrade

    set_risk_policy(paper.db, "owner", {"enabled": enabled})
    paper.db.add(VirtualPosition(portfolio_id="own", symbol="NASDAQ:AAPL", quantity=10, avg_entry_price=100))
    paper.db.commit()
    if enabled:
        with pytest.raises(HTTPException) as failure:
            await manual(paper, symbol="NASDAQ:AAPL", side=side, quantity=1)
        assert failure.value.status_code == 422
        assert "cost basis" in failure.value.detail
    else:
        response = await manual(paper, symbol="NASDAQ:AAPL", side=side, quantity=1)
        assert response["status"] == "rejected", response
        assert "cost basis" in response["risk_rejection"]
    paper.db.expire_all()
    assert paper.db.query(VirtualTrade).count() == 0
    position = paper.db.query(VirtualPosition).one()
    assert position.quantity == 10
    assert position.avg_entry_price == 100  # Never manufacture entry-date FX from today's rate.
    assert paper.db.get(VirtualPortfolio, "own").current_cash == 100000
