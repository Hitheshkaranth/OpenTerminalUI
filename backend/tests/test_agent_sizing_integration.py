"""Independent QC of sizing through the public agent tool registry."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def test_sizing_registry_permissions_and_strategy_isolation():
    from backend.agent.tools.market_tools import build_default_registry, build_strategy_registry

    registry = build_default_registry("sizing-owner")
    spec = registry.get("get_trade_size")
    assert spec.read_only is True
    assert spec.write_class == "none"
    assert "get_trade_size" in registry.filtered(allow_writes=False).names()
    assert "propose_paper_order" not in registry.filtered(allow_writes=False).names()
    assert "get_trade_size" not in build_default_registry().names()
    assert "get_trade_size" not in build_strategy_registry().names()


@pytest.mark.asyncio
async def test_sizing_executes_read_only_and_uses_marked_equity(monkeypatch):
    from backend.agent.tools import action_tools, sizing_tools
    from backend.agent.tools.market_tools import build_default_registry
    from backend.models import VirtualOrder, VirtualPortfolio, VirtualPosition, VirtualTrade
    from backend.models.agent_proposals import AgentProposal
    from backend.shared.db import Base

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        db.add_all([
            VirtualPortfolio(id="own", user_id="owner", name="Own", initial_capital=100000, current_cash=50000),
            VirtualPortfolio(id="foreign", user_id="someone-else", name="Other", initial_capital=900000, current_cash=900000),
            VirtualPosition(portfolio_id="own", symbol="AAPL", quantity=100, avg_entry_price=1),
        ])
        db.commit()

    async def marks(symbols):
        assert symbols == ["AAPL", "MSFT"]
        return ({"AAPL": 500, "MSFT": 100}, {
            "AAPL": {"source": "frozen", "quality": "delayed", "as_of": "2026-11-15T12:00:00Z"},
            "MSFT": {"source": "frozen", "quality": "cached", "as_of": "2026-11-15T12:00:00Z"},
        })

    monkeypatch.setattr(sizing_tools, "SessionLocal", factory)
    monkeypatch.setattr(action_tools, "_mark_prices", marks)
    registry = build_default_registry("owner").filtered(allow_writes=False)
    result = await registry.execute("get_trade_size", {"symbol": "MSFT", "stop_price": 90, "portfolio_id": "own"})
    assert result["ok"], result
    data = result["data"]
    assert data["marked_equity"] == 100000
    assert data["quantity"] == 100
    assert data["estimated_stop_loss"] == 1000
    assert data["estimated_cash_after"] == 39980
    assert data["estimated_position_pct_after"] <= 20
    assert result["provenance"]["quality"] == "cached"
    json.dumps(result, allow_nan=False)

    denied = await registry.execute("get_trade_size", {"symbol": "MSFT", "stop_price": 90, "portfolio_id": "foreign"})
    assert denied["ok"] is False
    assert denied["error"]["code"] == "not_found"
    with factory() as db:
        assert db.get(VirtualPortfolio, "own").current_cash == 50000
        assert db.query(VirtualPosition).one().quantity == 100
        assert db.query(AgentProposal).count() == 0
        assert db.query(VirtualOrder).count() == 0
        assert db.query(VirtualTrade).count() == 0
    engine.dispose()
