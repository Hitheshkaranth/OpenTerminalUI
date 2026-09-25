from __future__ import annotations

import asyncio

import numpy as np
import pandas as pd
import pytest

from backend.core.backtest_analytics import compute_trade_analytics, pair_round_trips
from backend.core.backtesting_models import BacktestConfig
from backend.core.single_asset_backtest import BacktestEngine


def _fill(date: str, action: str, qty: float, price: float) -> dict:
    signed = qty if action == "BUY" else -qty
    return {"date": date, "action": action, "quantity": signed, "price": price}


# Hand-computed sequence: scale-in long with partial exits, a short scale-in that is
# covered by a reversing BUY, a breakeven close, and an open position at the end.
FILLS = [
    _fill("2026-01-01", "BUY", 10, 100.0),   # long 10 @100
    _fill("2026-01-02", "BUY", 10, 110.0),   # scale-in -> long 20, avg 105
    _fill("2026-01-05", "SELL", 5, 120.0),   # partial exit: +5*15 = +75
    _fill("2026-01-06", "SELL", 15, 110.0),  # flat: +15*5 = +75  -> trip 1 = +150
    _fill("2026-01-07", "SELL", 10, 110.0),  # short 10 @110
    _fill("2026-01-08", "SELL", 10, 120.0),  # scale-in -> short 20, avg 115
    _fill("2026-01-09", "BUY", 30, 125.0),   # cover 20: -20*10 = -200 (trip 2); reverse long 10 @125
    _fill("2026-01-12", "SELL", 10, 125.0),  # flat at cost -> trip 3 = 0 (breakeven)
    _fill("2026-01-13", "BUY", 5, 90.0),     # still open at end -> not a round trip
]


def test_pair_round_trips_average_cost_with_scale_ins_partials_and_shorts() -> None:
    trips = pair_round_trips(FILLS)
    assert [t["side"] for t in trips] == ["long", "short", "long"]
    assert [t["pnl"] for t in trips] == pytest.approx([150.0, -200.0, 0.0])

    first = trips[0]
    assert first["entry_date"] == "2026-01-01" and first["exit_date"] == "2026-01-06"
    assert first["entry_price"] == pytest.approx(105.0)
    assert first["exit_price"] == pytest.approx(112.5)  # (5*120 + 15*110) / 20
    assert first["quantity"] == pytest.approx(20.0)
    assert first["return_pct"] == pytest.approx(150.0 / 2100.0 * 100.0)
    assert first["holding_days"] == 5

    short = trips[1]
    assert short["entry_price"] == pytest.approx(115.0)
    assert short["exit_price"] == pytest.approx(125.0)
    assert short["return_pct"] == pytest.approx(-200.0 / 2300.0 * 100.0)


def test_trade_analytics_summary_counts_round_trips_and_ignores_breakeven() -> None:
    summary = compute_trade_analytics(FILLS, [])["summary"]
    assert summary["fill_count"] == 9
    assert summary["total_trades"] == 3
    assert summary["winning_trades"] == 1
    assert summary["losing_trades"] == 1
    assert summary["breakeven_trades"] == 1
    assert summary["win_rate"] == pytest.approx(50.0)  # breakeven excluded from denominator
    assert summary["profit_factor"] == pytest.approx(0.75)
    assert summary["expectancy"] == pytest.approx(-50.0 / 3.0, abs=1e-6)
    assert summary["largest_win"] == pytest.approx(150.0)
    assert summary["largest_loss"] == pytest.approx(-200.0)


def test_engine_trade_stats_match_round_trip_analytics() -> None:
    prices = [100, 102, 104, 103, 101, 99, 98, 100, 103, 105]
    frame = pd.DataFrame({"date": [f"2026-02-{i:02d}" for i in range(1, 11)], "close": prices})
    signals = pd.Series([1, 1, 1, -1, -1, -1, 1, 1, 0, 0])
    result = BacktestEngine(BacktestConfig(initial_cash=10_000, position_size=10)).run("T", frame, signals)
    summary = compute_trade_analytics([t.model_dump() for t in result.trades], [])["summary"]
    assert summary["total_trades"] == 3
    assert result.win_rate == pytest.approx(summary["win_rate"])
    assert result.profit_factor == pytest.approx(summary["profit_factor"])


def test_capital_fraction_sizing_does_not_rebalance_every_bar() -> None:
    # Before the fix, units were recomputed from equity every bar, emitting a
    # rebalancing fill almost daily while the signal stayed long/short.
    rng = np.random.default_rng(7)
    prices = 100 * np.exp(np.cumsum(rng.normal(0, 0.02, 60)))
    frame = pd.DataFrame({"date": pd.bdate_range("2026-01-01", periods=60).strftime("%Y-%m-%d"), "close": prices})
    signals = pd.Series([1] * 30 + [-1] * 30)
    result = BacktestEngine(BacktestConfig(initial_cash=100_000, position_fraction=0.6, fee_bps=5)).run("T", frame, signals)
    assert len(result.trades) == 2  # open long, then one reversing SELL
    assert len(pair_round_trips([t.model_dump() for t in result.trades])) == 1


def test_risk_summary_beta_aligns_on_dates(monkeypatch) -> None:
    from backend.risk_engine import routes

    rng = np.random.default_rng(3)
    dates = pd.date_range("2026-01-01 03:45", periods=250, freq="B", tz="UTC")
    bm = pd.Series(rng.normal(0, 0.01, len(dates)), index=dates)
    stock = 0.9 * bm + pd.Series(rng.normal(0, 0.002, len(dates)), index=dates)
    # The benchmark is missing a handful of sessions the stock traded.
    bm_missing = bm.drop(bm.index[[20, 60, 100, 140, 180, 220]])

    async def fake_load(symbols):
        if symbols == ["^NSEI"]:
            return pd.DataFrame({"^NSEI": bm_missing})
        return pd.DataFrame({"RELIANCE": stock})

    async def fake_targets(db, ticker=None):
        return ["RELIANCE"]

    class _Cls:
        country_code = "IN"

    async def fake_classify(_t):
        return _Cls()

    monkeypatch.setattr(routes, "_load_symbols_returns", fake_load)
    monkeypatch.setattr(routes, "_get_target_symbols", fake_targets)
    monkeypatch.setattr(routes.market_classifier, "classify", fake_classify)
    out = asyncio.run(routes.get_risk_summary(ticker="RELIANCE", db=None, user=None))
    assert out.beta == pytest.approx(0.9, abs=0.05)
