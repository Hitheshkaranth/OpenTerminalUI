from __future__ import annotations

import pandas as pd

from backend.core.backtesting_models import BacktestConfig
from backend.core.single_asset_backtest import BacktestEngine, generate_sma_crossover_signals


def _synthetic_ohlcv() -> pd.DataFrame:
    prices = [100, 101, 103, 104, 103, 102, 101, 100, 99, 98, 99, 100]
    return pd.DataFrame(
        {
            "date": [f"2026-01-{i:02d}" for i in range(1, len(prices) + 1)],
            "open": prices,
            "high": [p + 1 for p in prices],
            "low": [p - 1 for p in prices],
            "close": prices,
            "volume": [1000] * len(prices),
        }
    )


def test_single_asset_backtest_engine_runs_and_returns_metrics() -> None:
    frame = _synthetic_ohlcv()
    signals = pd.Series([0, 1, 1, 1, 0, -1, -1, 0, 1, 1, 0, 0], dtype=int)
    result = BacktestEngine(BacktestConfig(initial_cash=10000, fee_bps=0, slippage_bps=0)).run(
        symbol="TEST",
        frame=frame,
        signals=signals,
    )
    assert result.symbol == "TEST"
    assert result.bars == len(frame)
    assert isinstance(result.total_return, float)
    assert len(result.equity_curve) == len(frame)
    assert len(result.trades) > 0


def test_builtin_sma_strategy_produces_ternary_signals() -> None:
    frame = _synthetic_ohlcv()
    signals = generate_sma_crossover_signals(frame, short_window=2, long_window=4)
    assert len(signals) == len(frame)
    assert set(int(v) for v in signals.tolist()).issubset({-1, 0, 1})
