"""Predeclared expanding-window selection, followed by disjoint next-window tests.

The grid and fold plan are fixed before any test is opened. No language model
chooses candidates from test feedback. This evaluates the grid selector, not the
separate language model's final SMA proposal.
"""

from __future__ import annotations

import math
import time
from typing import Any

import pandas as pd

from backend.core.single_asset_backtest import generate_sma_crossover_signals


PROTOCOL_VERSION = "sma_expanding_grid_v1"
PARAMETER_GRID = ((5, 20), (10, 40), (20, 50), (30, 90))
INITIAL_TRAIN_BARS = 120
N_FOLDS = 3
MIN_TEST_BARS = 30
MAX_HISTORY_BARS = 1500


def protocol_manifest() -> dict[str, Any]:
    return {
        "version": PROTOCOL_VERSION, "grid": [list(pair) for pair in PARAMETER_GRID],
        "initial_train_bars": INITIAL_TRAIN_BARS, "folds": N_FOLDS,
        "min_test_bars": MIN_TEST_BARS, "max_history_bars": MAX_HISTORY_BARS,
        "selection_metric": "training_sharpe", "tie_break": "grid_order",
        "fee_bps": 5, "slippage_bps": 5, "signal_delay_bars": 1,
        "liquidate_each_test_window": True,
        "universe_policy": "one_fixed_preselected_symbol",
    }


def _check_deadline(deadline: float | None) -> None:
    if deadline is not None and time.monotonic() >= deadline:
        raise TimeoutError("Walk-forward wall-clock budget exhausted")


def _metrics(curve: list[dict[str, Any]], *, initial_cash: float, trades: int) -> dict[str, Any]:
    nav = pd.Series([initial_cash, *(row["equity"] for row in curve)])
    returns = nav.pct_change().dropna()
    vol = returns.std() * math.sqrt(252)
    sharpe = returns.mean() * 252 / vol if vol > 0 else 0.0
    return {
        "sharpe": float(sharpe) if math.isfinite(sharpe) else None,
        "total_return_pct": float((nav.iloc[-1] / initial_cash - 1) * 100),
        "max_drawdown_pct": float((nav / nav.cummax() - 1).min() * 100),
        "trades": trades,
    }


def evaluate_expanding_walkforward(session: Any, *, deadline: float | None = None) -> dict[str, Any]:
    """Evaluate the immutable grid using only data strictly before each test.

    Earlier test periods may become training data in later folds, as in a live
    expanding-window process. Fold test accounts start flat and liquidate with
    costs; their net returns are chained without a fictitious dated baseline.
    """
    frame = session._frame.copy(deep=True)
    total = len(frame)
    if total < INITIAL_TRAIN_BARS + N_FOLDS * MIN_TEST_BARS or total > MAX_HISTORY_BARS:
        return {
            "status": "unsupported", "protocol": protocol_manifest(),
            "reason": f"Walk-forward requires {INITIAL_TRAIN_BARS + N_FOLDS * MIN_TEST_BARS}-{MAX_HISTORY_BARS} daily bars",
        }
    width = (total - INITIAL_TRAIN_BARS) // N_FOLDS
    folds = []
    combined = []
    capital = 100000.0
    trades = 0
    for fold_index in range(N_FOLDS):
        _check_deadline(deadline)
        train_end = INITIAL_TRAIN_BARS + fold_index * width
        test_end = total if fold_index == N_FOLDS - 1 else train_end + width
        training = frame.iloc[:train_end].copy(deep=True)
        candidates = []
        for pair in PARAMETER_GRID:
            _check_deadline(deadline)
            signals = generate_sma_crossover_signals(training, *pair).shift(1).fillna(0).astype(int)
            measured = session._run(training, signals, pair, "walk_forward_train", liquidate_at_end=True)
            metric = measured["metrics"]["sharpe"]
            if metric is None or not math.isfinite(metric):
                raise ValueError("Walk-forward candidate produced no finite training Sharpe")
            candidates.append((pair, measured))
        pair, selected = max(candidates, key=lambda item: item[1]["metrics"]["sharpe"])
        _check_deadline(deadline)
        start = train_end - pair[1] - 1
        warmed = frame.iloc[start:test_end].copy(deep=True).reset_index(drop=True)
        all_signals = generate_sma_crossover_signals(warmed, *pair).shift(1).fillna(0).astype(int)
        offset = train_end - start
        test_frame = warmed.iloc[offset:].reset_index(drop=True)
        test_signals = all_signals.iloc[offset:].reset_index(drop=True)
        tested = session._run(test_frame, test_signals, pair, "walk_forward_test", liquidate_at_end=True)
        for row in tested["equity_curve"]:
            combined.append({"date": row["date"], "equity": capital * row["equity"] / tested["initial_cash"]})
        capital = combined[-1]["equity"]
        trades += tested["metrics"]["trades"]
        folds.append({
            "fold": fold_index + 1, "train_start": training.iloc[0]["date"].isoformat(),
            "train_end": training.iloc[-1]["date"].isoformat(), "train_bars": len(training),
            "test_start": test_frame.iloc[0]["date"].isoformat(), "test_end": test_frame.iloc[-1]["date"].isoformat(),
            "test_bars": len(test_frame), "selected_params": {"short_window": pair[0], "long_window": pair[1]},
            "candidates_evaluated": len(candidates), "train_metrics": selected["metrics"],
            "test_metrics": tested["metrics"],
        })
    return {
        "status": "completed", "protocol": protocol_manifest(), "dataset_id": session.dataset_id,
        "ticker": session.ticker, "universe": [session.ticker], "initial_cash": 100000.0,
        "folds": folds, "selection_count": len(folds) * len(PARAMETER_GRID),
        "metrics": _metrics(combined, initial_cash=100000.0, trades=trades), "equity_curve": combined,
        "provenance": dict(session.provenance),
        "limitations": [
            "Walk-forward evaluates the predeclared grid selector, not the LLM-selected single strategy.",
            "Walk-forward and the final holdout share dataset/test dates; they are not independent replication.",
            "One preselected symbol is fixed throughout; this does not represent a historical index universe or delisted securities.",
            "Each fold starts flat and liquidates with costs; aggregate returns chain these independently funded fold returns.",
        ],
    }
