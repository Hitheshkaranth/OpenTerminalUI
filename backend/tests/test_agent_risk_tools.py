"""Tests for the portfolio risk tools (risk_tools.py).

Follows test_agent_market_tools.py's pattern: monkeypatch the module's own helper
functions (data loading, engine singletons) rather than the DB or network, then assert
on the compact envelope the handler returns. The one test that matters most is
``test_get_portfolio_risk_empty_portfolio_is_err_not_zero_report`` — the failure mode
this whole file exists to prevent is an agent reporting a fabricated zero-filled risk
number as if it were real.
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

import backend.agent.tools.risk_tools as rt
from backend.agent.tools.registry import ToolRegistry


def _holding(ticker: str, quantity: float, avg_buy_price: float) -> SimpleNamespace:
    return SimpleNamespace(ticker=ticker, quantity=quantity, avg_buy_price=avg_buy_price)


def _synthetic_returns(symbols: list[str], n: int = 40, seed: int = 7) -> pd.DataFrame:
    idx = pd.date_range("2024-01-01", periods=n, freq="B")
    rng = np.random.default_rng(seed)
    data = {s: rng.normal(0.0006, 0.012, n) for s in symbols}
    return pd.DataFrame(data, index=idx)


class DummyDB:
    def close(self) -> None:
        pass


# ---------------------------------------------------------------------------
# Registry / schema sanity
# ---------------------------------------------------------------------------

def test_risk_tool_specs_schema_and_registration():
    specs = rt.risk_tool_specs("user-1")
    names = {s.name for s in specs}
    assert names == {
        "get_portfolio_risk", "run_stress_test", "optimize_portfolio", "get_exposure_breakdown",
    }
    reg = ToolRegistry()
    reg.register_many(specs)  # no name collisions
    for spec in specs:
        assert spec.parameters["type"] == "object"
        assert spec.read_only is True
        assert spec.write_class == "none"
        assert spec.description  # every tool documents itself


# ---------------------------------------------------------------------------
# get_portfolio_risk
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_portfolio_risk_happy_path(monkeypatch):
    holdings = [_holding("AAPL", 10, 150.0), _holding("MSFT", 5, 300.0)]
    monkeypatch.setattr(rt, "_resolve_holdings", lambda portfolio_id: (holdings, "current"))

    async def fake_returns_frame(symbols, range_str="2y"):
        return _synthetic_returns(symbols, n=40)

    monkeypatch.setattr(rt, "_returns_frame", fake_returns_frame)

    out = await rt._get_portfolio_risk({})
    assert out["ok"] is True
    data = out["data"]
    assert data["symbols"] == ["AAPL", "MSFT"]
    assert isinstance(data["var_parametric"], float)
    assert isinstance(data["cvar_parametric"], float)
    assert isinstance(data["max_drawdown_pct"], float)
    assert data["beta_vs_benchmark"] is not None
    assert data["concentration"]["top_position"] in {"AAPL", "MSFT"}
    assert data["concentration"]["top_position_weight_pct"] > 0


@pytest.mark.asyncio
async def test_get_portfolio_risk_empty_portfolio_is_err_not_zero_report(monkeypatch):
    # No holdings at all -> must be err(), never a VaR=0.0 report an agent could repeat as real.
    monkeypatch.setattr(rt, "_resolve_holdings", lambda portfolio_id: ([], "current"))

    out = await rt._get_portfolio_risk({})
    assert out["ok"] is False
    assert out["error"]["code"] == "empty_portfolio"
    assert "data" not in out


@pytest.mark.asyncio
async def test_get_portfolio_risk_insufficient_history_is_err(monkeypatch):
    holdings = [_holding("AAPL", 10, 150.0)]
    monkeypatch.setattr(rt, "_resolve_holdings", lambda portfolio_id: (holdings, "current"))

    async def fake_returns_frame(symbols, range_str="2y"):
        return pd.DataFrame()  # provider failure / no price history

    monkeypatch.setattr(rt, "_returns_frame", fake_returns_frame)

    out = await rt._get_portfolio_risk({})
    assert out["ok"] is False
    assert out["error"]["code"] == "insufficient_history"


@pytest.mark.asyncio
async def test_get_portfolio_risk_not_found_portfolio_is_err(monkeypatch):
    def fake_resolve(portfolio_id):
        return rt.err("Portfolio not found", code="not_found")

    monkeypatch.setattr(rt, "_resolve_holdings", fake_resolve)
    out = await rt._get_portfolio_risk({"portfolio_id": "does-not-exist"})
    assert out["ok"] is False
    assert out["error"]["code"] == "not_found"


# ---------------------------------------------------------------------------
# run_stress_test
# ---------------------------------------------------------------------------

class _FakeStressResult:
    def to_payload(self):
        return {
            "scenario": "2008 Global Financial Crisis",
            "scenario_key": "2008_gfc",
            "portfolio_id": "current",
            "total_pnl": -1000.0,
            "holdings": [{"symbol": "AAPL", "pnl": -1000.0}],
            "sector_summary": [],
        }


def test_run_stress_test_happy_path(monkeypatch):
    monkeypatch.setattr(rt, "SessionLocal", lambda: DummyDB())
    monkeypatch.setattr(
        rt.stress_test_service, "run_stress_test",
        lambda db, pid, scenario, params: _FakeStressResult(),
    )

    out = rt._run_stress_test({"scenario": "2008_gfc"})
    assert out["ok"] is True
    assert out["provenance"]["quality"] == "synthetic"
    assert out["data"]["scenario_key"] == "2008_gfc"


def test_run_stress_test_unknown_scenario_is_err(monkeypatch):
    monkeypatch.setattr(rt, "SessionLocal", lambda: DummyDB())

    def raise_key_error(db, pid, scenario, params):
        raise KeyError(scenario)

    monkeypatch.setattr(rt.stress_test_service, "run_stress_test", raise_key_error)
    monkeypatch.setattr(rt.stress_test_service, "list_scenarios", lambda: [{"key": "2008_gfc"}])

    out = rt._run_stress_test({"scenario": "not_a_real_scenario"})
    assert out["ok"] is False
    assert out["error"]["code"] == "unknown_scenario"
    assert "2008_gfc" in out["error"]["hint"]


def test_run_stress_test_portfolio_not_found_is_err(monkeypatch):
    monkeypatch.setattr(rt, "SessionLocal", lambda: DummyDB())

    def raise_lookup_error(db, pid, scenario, params):
        raise LookupError("Portfolio not found")

    monkeypatch.setattr(rt.stress_test_service, "run_stress_test", raise_lookup_error)
    out = rt._run_stress_test({"portfolio_id": "ghost"})
    assert out["ok"] is False
    assert out["error"]["code"] == "not_found"


# ---------------------------------------------------------------------------
# optimize_portfolio
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_optimize_portfolio_happy_path(monkeypatch):
    async def fake_returns_frame(symbols, range_str="2y"):
        return _synthetic_returns(symbols, n=60)

    monkeypatch.setattr(rt, "_returns_frame", fake_returns_frame)

    out = await rt._optimize_portfolio({"tickers": ["AAPL", "MSFT", "GOOG"], "objective": "min_vol"})
    assert out["ok"] is True
    data = out["data"]
    assert set(data["weights"]) == {"AAPL", "MSFT", "GOOG"}
    assert abs(sum(data["weights"].values()) - 1.0) < 1e-4
    assert data["objective"] == "min_vol"
    assert "efficient_frontier" in data


@pytest.mark.asyncio
async def test_optimize_portfolio_too_few_tickers_is_err():
    out = await rt._optimize_portfolio({"tickers": ["AAPL"]})
    assert out["ok"] is False
    assert out["error"]["code"] == "insufficient_universe"


@pytest.mark.asyncio
async def test_optimize_portfolio_empty_portfolio_fallback_is_err(monkeypatch):
    # No tickers given and no holdings to fall back to -> err, not an empty-universe optimization.
    monkeypatch.setattr(rt, "_resolve_holdings", lambda portfolio_id: rt.err("No holdings available", code="not_found"))
    out = await rt._optimize_portfolio({})
    assert out["ok"] is False
    assert out["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_optimize_portfolio_bad_objective_is_err():
    out = await rt._optimize_portfolio({"tickers": ["AAPL", "MSFT"], "objective": "yolo"})
    assert out["ok"] is False
    assert out["error"]["code"] == "bad_objective"


# ---------------------------------------------------------------------------
# get_exposure_breakdown
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_exposure_breakdown_happy_path(monkeypatch):
    holdings = [_holding("AAPL", 10, 150.0), _holding("RELIANCE", 4, 2500.0)]
    monkeypatch.setattr(rt, "_resolve_holdings", lambda portfolio_id: (holdings, "current"))

    async def fake_classify(symbol):
        return SimpleNamespace(country_name="United States" if symbol == "AAPL" else "India")

    monkeypatch.setattr(rt.market_classifier, "classify", fake_classify)

    out = await rt._get_exposure_breakdown({})
    assert out["ok"] is True
    data = out["data"]
    assert data["asset_class"] == [{"name": "equity", "weight_pct": 100.0}]
    geos = {row["name"] for row in data["geography"]}
    assert geos == {"United States", "India"}
    assert sum(row["weight_pct"] for row in data["sector"]) == pytest.approx(100.0, abs=0.1)


@pytest.mark.asyncio
async def test_get_exposure_breakdown_empty_portfolio_is_err(monkeypatch):
    monkeypatch.setattr(rt, "_resolve_holdings", lambda portfolio_id: rt.err("No holdings available", code="not_found"))
    out = await rt._get_exposure_breakdown({})
    assert out["ok"] is False
    assert out["error"]["code"] == "not_found"
    assert "data" not in out
