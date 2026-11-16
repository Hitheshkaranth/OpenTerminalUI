"""Offline next-window tests for the fixed expanding SMA selector."""

import time

import numpy as np
import pandas as pd
import pytest

from backend.agent.strategy_loop.holdout import SMAHoldoutSession
from backend.agent.strategy_loop.walkforward import PARAMETER_GRID, protocol_manifest
from backend.agent.strategy_loop.orchestrator import StrategyLoopOrchestrator


def history(n=360):
    close = 100 + np.arange(n) * 0.08 + 10 * np.sin(np.arange(n) / 9)
    return pd.DataFrame({"date": pd.date_range("2023-01-01", periods=n), "open": close,
                         "high": close + 1, "low": close - 1, "close": close})


def test_walkforward_dates_expand_and_tests_are_disjoint_with_bounded_grid(monkeypatch):
    session = SMAHoldoutSession("AAPL", history())
    calls = []
    original = session._run

    def record(frame, signals, pair, partition, **kwargs):
        calls.append((frame.copy(), signals.copy(), pair, partition, kwargs))
        return original(frame, signals, pair, partition, **kwargs)

    monkeypatch.setattr(session, "_run", record)
    result = session.walk_forward()
    assert result["status"] == "completed"
    assert result["selection_count"] == 12
    assert len(calls) == 15
    folds = result["folds"]
    assert [fold["train_bars"] for fold in folds] == [120, 200, 280]
    assert all(fold["test_bars"] == 80 and fold["candidates_evaluated"] == len(PARAMETER_GRID) for fold in folds)
    for fold in folds:
        assert pd.Timestamp(fold["train_end"]) < pd.Timestamp(fold["test_start"])
    assert all(pd.Timestamp(left["test_end"]) < pd.Timestamp(right["test_start"]) for left, right in zip(folds, folds[1:]))
    dates = [row["date"] for row in result["equity_curve"]]
    assert len(dates) == len(set(dates)) == 240
    assert result["universe"] == ["AAPL"]
    assert "not independent replication" in " ".join(result["limitations"])
    with pytest.raises(ValueError, match="only once"):
        session.walk_forward()


def test_future_prices_cannot_change_earlier_fold_training_or_selection():
    original = history()
    perturbed = original.copy()
    for column in ("open", "high", "low", "close"):
        perturbed.loc[280:, column] *= np.linspace(1, 4, 80)
    first = SMAHoldoutSession("AAPL", original).walk_forward()
    second = SMAHoldoutSession("AAPL", perturbed).walk_forward()
    for before, after in zip(first["folds"], second["folds"]):
        assert before["selected_params"] == after["selected_params"]
        assert before["train_metrics"] == after["train_metrics"]
    assert first["folds"][:2] == second["folds"][:2]
    assert first["folds"][2]["test_metrics"] != second["folds"][2]["test_metrics"]


def test_first_test_window_prices_do_not_choose_that_windows_parameters():
    original = history()
    perturbed = original.copy()
    perturbed.loc[120:199, ["open", "high", "low", "close"]] *= 2
    first = SMAHoldoutSession("AAPL", original).walk_forward()["folds"][0]
    second = SMAHoldoutSession("AAPL", perturbed).walk_forward()["folds"][0]
    assert first["selected_params"] == second["selected_params"]
    assert first["train_metrics"] == second["train_metrics"]


def test_each_test_includes_entry_and_terminal_liquidation_costs():
    frame = history()
    prices = np.arange(100, 460, dtype=float)
    for column in ("open", "high", "low", "close"):
        frame[column] = prices
    result = SMAHoldoutSession("AAPL", frame).walk_forward()
    expected_capital = 100000.0
    for index, fold in enumerate(result["folds"]):
        first, last = prices[120 + index * 80], prices[199 + index * 80]
        shares = int((100000 / 1.001) // first)
        cash = 100000 - shares * first * 1.001
        final = cash + shares * last * 0.999
        assert fold["test_metrics"]["trades"] == 2
        assert fold["test_metrics"]["total_return_pct"] == pytest.approx((final / 100000 - 1) * 100)
        expected_capital *= final / 100000
    assert result["equity_curve"][-1]["equity"] == pytest.approx(expected_capital)
    assert result["metrics"]["total_return_pct"] == pytest.approx((expected_capital / 100000 - 1) * 100)
    assert protocol_manifest()["signal_delay_bars"] == 1


def test_short_history_is_explicitly_unsupported_without_backtests(monkeypatch):
    session = SMAHoldoutSession("AAPL", history(180))
    monkeypatch.setattr(session, "_run", lambda *a, **k: pytest.fail("insufficient history must not be tested"))
    assert session.walk_forward()["status"] == "unsupported"


def test_wall_clock_timeout_seals_walkforward_against_retry():
    session = SMAHoldoutSession("AAPL", history())
    with pytest.raises(TimeoutError):
        session.walk_forward(deadline=time.monotonic() - 1)
    with pytest.raises(ValueError, match="only once"):
        session.walk_forward()


@pytest.mark.parametrize("prompt,context,expected", [
    ("backtest AAPL", None, "AAPL"), ("test $msft with SMA", None, "MSFT"),
    ("try symbol: reliance.ns", None, "RELIANCE.NS"),
    ("find a strategy", {"active_symbol": "TCS.NS"}, "TCS.NS"), ("aapl", None, "AAPL"),
])
def test_frozen_universe_uses_explicit_symbol_not_first_prompt_word(prompt, context, expected):
    assert StrategyLoopOrchestrator._ticker(prompt, context) == expected


def test_ambiguous_prompt_cannot_silently_choose_a_symbol():
    with pytest.raises(ValueError, match="explicit ticker"):
        StrategyLoopOrchestrator._ticker("find a strategy for me", {})
