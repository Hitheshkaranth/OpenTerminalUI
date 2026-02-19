from __future__ import annotations

import pandas as pd

from backend.core.backtesting_models import BacktestConfig
from backend.core.single_asset_backtest import BacktestEngine


def test_backtest_engine_emits_extended_metrics() -> None:
    frame = pd.DataFrame(
        [
            {"date": "2025-01-01", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1000},
            {"date": "2025-01-02", "open": 101, "high": 103, "low": 100, "close": 102, "volume": 1100},
            {"date": "2025-01-03", "open": 102, "high": 104, "low": 101, "close": 103, "volume": 1200},
            {"date": "2025-01-04", "open": 103, "high": 104, "low": 98, "close": 99, "volume": 900},
            {"date": "2025-01-05", "open": 99, "high": 101, "low": 97, "close": 100, "volume": 1000},
            {"date": "2025-01-06", "open": 100, "high": 106, "low": 99, "close": 105, "volume": 1300},
        ]
    )
    signals = pd.Series([1, 1, 0, -1, 0, 1], dtype=int)
    result = BacktestEngine(BacktestConfig(initial_cash=100000)).run(
        symbol="RELIANCE",
        asset="RELIANCE",
        frame=frame,
        signals=signals,
    )
    assert isinstance(result.sortino, float)
    assert isinstance(result.calmar, float)
    assert isinstance(result.omega, float)
    assert isinstance(result.profit_factor, float)
    assert isinstance(result.max_consecutive_losses, int)
    assert len(result.daily_returns) == max(0, len(frame) - 1)
    assert len(result.drawdown_series) == len(frame)
