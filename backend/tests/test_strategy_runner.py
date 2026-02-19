from __future__ import annotations

import pandas as pd
import pytest

from backend.core.strategy_runner import StrategyRunner


def _frame() -> pd.DataFrame:
    closes = [100, 101, 102, 103, 104, 105, 104, 103]
    return pd.DataFrame(
        {
            "date": [f"2026-01-{i:02d}" for i in range(1, len(closes) + 1)],
            "open": closes,
            "high": [v + 1 for v in closes],
            "low": [v - 1 for v in closes],
            "close": closes,
            "volume": [100] * len(closes),
        }
    )


def test_example_sma_strategy_runs() -> None:
    out = StrategyRunner().run("example:sma_crossover", _frame(), {"short_window": 2, "long_window": 3})
    assert len(out.signals) == len(_frame())
    assert out.stdout == ""


def test_additional_example_strategies_run() -> None:
    runner = StrategyRunner()
    ema = runner.run("example:ema_crossover", _frame(), {"short_window": 2, "long_window": 4})
    mr = runner.run("example:mean_reversion", _frame(), {"lookback": 3, "entry_z": 0.5})
    bo = runner.run("example:breakout_20", _frame(), {"lookback": 3})
    assert len(ema.signals) == len(_frame())
    assert len(mr.signals) == len(_frame())
    assert len(bo.signals) == len(_frame())
    assert set(int(v) for v in ema.signals.tolist()).issubset({-1, 0, 1})


def test_pure_jump_markov_vol_strategy_runs() -> None:
    runner = StrategyRunner()
    out = runner.run(
        "example:pure_jump_markov_vol",
        _frame(),
        {"n_particles": 64, "lookback": 20, "seed": 9},
    )
    assert len(out.signals) == len(_frame())
    assert set(int(v) for v in out.signals.tolist()).issubset({-1, 0, 1})


def test_inline_strategy_captures_stdout() -> None:
    code = """
def generate_signals(df, context):
    print("hello strategy")
    return [1 if i % 2 == 0 else 0 for i in range(len(df))]
"""
    out = StrategyRunner(timeout_seconds=1.0).run(code, _frame(), {})
    assert "hello strategy" in out.stdout
    assert set(int(v) for v in out.signals.tolist()).issubset({-1, 0, 1})


def test_inline_strategy_timeout() -> None:
    code = """
def generate_signals(df, context):
    for _ in range(10**8):
        pass
    return [0 for _ in range(len(df))]
"""
    with pytest.raises(TimeoutError):
        StrategyRunner(timeout_seconds=0.05).run(code, _frame(), {})


def test_inline_strategy_blocks_imports() -> None:
    code = """
import os
def generate_signals(df, context):
    return [0 for _ in range(len(df))]
"""
    with pytest.raises(ValueError):
        StrategyRunner(timeout_seconds=0.2).run(code, _frame(), {})
