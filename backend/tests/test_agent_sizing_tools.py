from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.agent.tools import sizing_tools as sizing
from backend.shared.db import Base


@pytest.fixture
def sizing_db(monkeypatch):
    from backend.models import VirtualPortfolio, VirtualPosition

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    db.add_all([
        VirtualPortfolio(id="mine", user_id="me", name="Mine", initial_capital=10000, current_cash=10000),
        VirtualPortfolio(id="other", user_id="them", name="Other", initial_capital=99999, current_cash=99999),
    ])
    db.commit()
    monkeypatch.setattr(sizing, "SessionLocal", factory)

    async def marks(symbols):
        return ({symbol: 100.0 for symbol in symbols},
                {symbol: {"source": "fixture", "quality": "delayed", "as_of": "2026-11-16"} for symbol in symbols})

    monkeypatch.setattr(sizing.action_tools, "_mark_prices", marks)
    yield db
    db.close()
    engine.dispose()


async def calculate(**kwargs):
    return await sizing.get_trade_size({"symbol": "AAPL", "stop_price": 90, **kwargs}, "me")


@pytest.mark.asyncio
async def test_risk_cap_and_input_evidence(sizing_db):
    result = await calculate()
    data = result["data"]
    assert data["quantity"] == 10
    assert data["cap_quantities"] == {"stop_risk": 10, "cash": 99, "concentration": 19}
    assert data["binding_constraints"] == ["stop_risk"]
    assert data["estimated_stop_loss"] == 100
    assert data["estimated_cash_after"] == 8998
    assert data["valuation_basis"] == "marked_prices"
    assert data["price_provenance"]["AAPL"]["quality"] == "delayed"
    assert result["provenance"]["quality"] == "delayed"
    assert any("Pending orders" in note for note in data["notes"])
    json.dumps(result, allow_nan=False)


@pytest.mark.asyncio
async def test_enabled_policy_clamps_discretionary_sizing_overrides(sizing_db):
    from backend.agent.trade_preflight import set_risk_policy

    set_risk_policy(sizing_db, "me", {"enabled": True, "risk_budget_pct": .5, "max_position_pct": 10})
    result = await calculate(risk_budget_pct=5, max_position_pct=100)
    assert result["ok"]
    assert result["data"]["quantity"] == 5
    assert result["data"]["risk_budget_pct"] == .5
    assert result["data"]["max_position_pct"] == 10
    assert result["data"]["risk_policy_applied"]["enabled"] is True


@pytest.mark.asyncio
async def test_concentration_accounts_for_existing_marked_position_and_costs(sizing_db):
    from backend.models import VirtualPosition

    sizing_db.add(VirtualPosition(portfolio_id="mine", symbol="AAPL", quantity=10, avg_entry_price=1))
    sizing_db.commit()
    data = (await calculate(stop_price=99, risk_budget_pct=5))["data"]
    assert data["marked_equity"] == 11000
    assert data["quantity"] == 11
    assert data["binding_constraints"] == ["concentration"]
    assert data["estimated_position_pct_after"] <= 20
    # Twelve shares would meet a pre-fee cap exactly, but breach the post-fee cap.
    assert 2200 / (11000 - 1200 * .002) * 100 > 20


@pytest.mark.asyncio
async def test_cash_cap_and_cost_reserve(sizing_db):
    data = (await calculate(stop_price=99, risk_budget_pct=5, max_position_pct=100))["data"]
    assert data["quantity"] == 99
    assert data["estimated_cash_after"] == pytest.approx(80.2)
    assert "cash" in data["binding_constraints"]


@pytest.mark.asyncio
async def test_overweight_returns_explained_zero(sizing_db):
    from backend.models import VirtualPosition

    sizing_db.add(VirtualPosition(portfolio_id="mine", symbol="AAPL", quantity=100, avg_entry_price=1))
    sizing_db.commit()
    data = (await calculate())["data"]
    assert data["quantity"] == 0
    assert data["zero_size_reasons"] == ["concentration"]


@pytest.mark.asyncio
@pytest.mark.parametrize("overrides", [
    {"symbol": ""}, {"symbol": True}, {"symbol": "x" * 65},
    {"stop_price": True}, {"stop_price": float("nan")}, {"stop_price": float("inf")},
    {"stop_price": -1}, {"stop_price": 0}, {"stop_price": "90"},
    {"stop_price": 100}, {"stop_price": 110},
    {"risk_budget_pct": True}, {"risk_budget_pct": 0}, {"risk_budget_pct": -1}, {"risk_budget_pct": 6},
    {"max_position_pct": 101}, {"max_position_pct": 0}, {"max_position_pct": float("nan")},
    {"portfolio_id": ""}, {"portfolio_id": True},
])
async def test_invalid_inputs(sizing_db, overrides):
    response = await calculate(**overrides)
    assert response["ok"] is False
    assert response["error"]["code"] == "invalid_args"


@pytest.mark.asyncio
async def test_foreign_portfolio_is_not_found_without_quote_access(sizing_db, monkeypatch):
    async def forbidden(symbols):
        pytest.fail("Foreign portfolio must not access prices")

    monkeypatch.setattr(sizing.action_tools, "_mark_prices", forbidden)
    response = await calculate(portfolio_id="other")
    assert response["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_missing_any_holding_mark_never_falls_back(sizing_db, monkeypatch):
    from backend.models import VirtualPosition

    sizing_db.add(VirtualPosition(portfolio_id="mine", symbol="MSFT", quantity=10, avg_entry_price=100))
    sizing_db.commit()

    async def partial(symbols):
        return {"AAPL": 100}, {"AAPL": {"quality": "cached"}}

    monkeypatch.setattr(sizing.action_tools, "_mark_prices", partial)
    response = await calculate()
    assert response["error"]["code"] == "missing_prices"
    assert "MSFT" in response["error"]["message"]


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_price", [True, float("nan"), float("inf"), 0, -1])
async def test_invalid_prices_rejected(sizing_db, monkeypatch, bad_price):
    async def bad(symbols):
        return {"AAPL": bad_price}, {}

    monkeypatch.setattr(sizing.action_tools, "_mark_prices", bad)
    assert (await calculate())["error"]["code"] == "missing_prices"


@pytest.mark.asyncio
@pytest.mark.parametrize("quantity,side", [(-1, "long"), (1, "short"), (float("inf"), "long")])
async def test_invalid_or_short_holdings_fail_closed(sizing_db, quantity, side):
    from backend.models import VirtualPosition

    sizing_db.add(VirtualPosition(portfolio_id="mine", symbol="MSFT", quantity=quantity, side=side, avg_entry_price=100))
    sizing_db.commit()
    assert (await calculate())["error"]["code"] == "invalid_state"


@pytest.mark.asyncio
async def test_cash_only_zero_and_no_mutation(sizing_db):
    from backend.models import VirtualPortfolio, VirtualPosition, VirtualOrder, VirtualTrade
    from backend.models.agent_proposals import AgentProposal

    before = sizing_db.get(VirtualPortfolio, "mine").current_cash
    await calculate()
    sizing_db.expire_all()
    assert sizing_db.get(VirtualPortfolio, "mine").current_cash == before
    for model in [VirtualPosition, VirtualOrder, VirtualTrade, AgentProposal]:
        assert sizing_db.query(model).count() == 0
    portfolio = sizing_db.get(VirtualPortfolio, "mine")
    portfolio.current_cash = 0
    sizing_db.commit()
    assert (await calculate())["error"]["code"] == "invalid_state"


@pytest.mark.asyncio
async def test_symbol_cap(sizing_db, monkeypatch):
    from backend.models import VirtualPosition

    sizing_db.add_all([VirtualPosition(portfolio_id="mine", symbol=f"S{i}", quantity=1, avg_entry_price=100)
                      for i in range(50)])
    sizing_db.commit()
    assert (await calculate())["error"]["code"] == "too_many_symbols"


def test_read_only_tool_spec():
    from backend.agent.tools.registry import ToolRegistry

    spec, = sizing.sizing_tool_specs("me")
    assert spec.name == "get_trade_size"
    assert spec.read_only is True
    assert spec.write_class == "none"
    assert spec.parameters["required"] == ["symbol", "stop_price"]
    registry = ToolRegistry()
    registry.register(spec)
    assert registry.filtered(allow_writes=False).names() == ["get_trade_size"]


@pytest.mark.asyncio
@pytest.mark.parametrize("stored,requested", [
    ("NSE:TCS", "TCS"), ("NSE:TCS", "TCS.NS"), ("TCS.NS", "TCS"),
    ("BSE:TCS", "TCS.BO"), ("TCS.BO", "TCS"), ("NASDAQ:AAPL", "AAPL"),
])
async def test_ambiguous_aliases_cannot_bypass_concentration(sizing_db, stored, requested):
    from backend.models import VirtualPosition

    sizing_db.add(VirtualPosition(portfolio_id="mine", symbol=stored, quantity=100, avg_entry_price=100))
    sizing_db.commit()
    result = await calculate(symbol=requested)
    assert result["ok"] is False
    assert result["error"]["code"] == "ambiguous_symbols"


def test_identity_preserves_share_classes_and_exchange_differences():
    assert not sizing._has_ambiguous_aliases(["BRK.A", "BRK.B"])
    assert not sizing._has_ambiguous_aliases(["NSE:TCS", "BSE:TCS"])
    assert sizing._symbol_identity("BRK.B") == (None, "BRK.B")


@pytest.mark.asyncio
async def test_extreme_valuation_is_not_nonfinite_json(sizing_db, monkeypatch):
    from backend.models import VirtualPosition

    sizing_db.add(VirtualPosition(portfolio_id="mine", symbol="AAPL", quantity=1e308, avg_entry_price=100))
    sizing_db.commit()

    async def huge(symbols):
        return {"AAPL": 1e308}, {}

    monkeypatch.setattr(sizing.action_tools, "_mark_prices", huge)
    response = await calculate()
    assert response["ok"] is False
    assert response["error"]["code"] == "invalid_state"
    json.dumps(response, allow_nan=False)
