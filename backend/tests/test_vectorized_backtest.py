import numpy as np
import pandas as pd
import pytest
from backend.core.vectorized_backtest import vectorized_sweep, _safe_float

def test_vectorized_sweep_sma_crossover():
    rng = np.random.default_rng(5)
    # Build a trending close series (~500 pts)
    steps = rng.standard_normal(500) * 0.5 + 0.05
    close = 100 * np.exp(np.cumsum(steps / 100))
    prices = [{"close": p} for p in close]
    
    param_grid = {"fast": [5, 10, 20], "slow": [50, 100]}
    res = vectorized_sweep(prices, "sma_crossover", param_grid)
    
    assert res["n_combos"] == 6
    assert len(res["results"]) > 0
    
    # Check if results are sorted desc by sharpe (default)
    sharpes = [r["sharpe"] for r in res["results"]]
    assert sharpes == sorted(sharpes, reverse=True)
    
    # Best is the first result
    assert res["best"] == res["results"][0]
    
    # Heatmap check
    heatmap = res["heatmap"]
    assert heatmap is not None
    assert heatmap["x_param"] == "fast"
    assert heatmap["y_param"] == "slow"
    assert len(heatmap["x_values"]) == 3 # [5, 10, 20]
    assert len(heatmap["y_values"]) == 2 # [50, 100]
    assert len(heatmap["z"]) == 2 # rows correspond to slow (y)
    assert len(heatmap["z"][0]) == 3 # columns correspond to fast (x)

def test_vectorized_sweep_correctness():
    # Correctness check: for a single combo, recompute strat_ret by hand
    rng = np.random.default_rng(5)
    steps = rng.standard_normal(200) * 0.2 + 0.02
    close_vals = 100 * np.exp(np.cumsum(steps / 100))
    prices = [{"close": p} for p in close_vals]
    
    fast, slow = 10, 50
    res = vectorized_sweep(prices, "sma_crossover", {"fast": [fast], "slow": [slow]})
    
    # Hand calculation
    close_ser = pd.Series(close_vals)
    ma_fast = close_ser.rolling(fast).mean()
    ma_slow = close_ser.rolling(slow).mean()
    pos = (ma_fast > ma_slow).astype(float).shift(1).fillna(0.0)
    ret = close_ser.pct_change().fillna(0.0)
    strat_ret = pos * ret
    # total_return = (1+strat_ret).prod() - 1
    equity = (1 + strat_ret).cumprod()
    expected_total_return = equity.iloc[-1] - 1
    
    actual_total_return = res["results"][0]["total_return"]
    assert abs(actual_total_return - _safe_float(expected_total_return)) < 1e-6

def test_vectorized_sweep_rsi_threshold():
    rng = np.random.default_rng(5)
    steps = rng.standard_normal(500) * 0.5
    close = 100 * np.exp(np.cumsum(steps / 100))
    prices = [{"close": p} for p in close]
    
    param_grid = {"period": [14], "oversold": [30, 40], "overbought": [60, 70]}
    res = vectorized_sweep(prices, "rsi_threshold", param_grid)
    
    assert res["n_combos"] == 4
    assert len(res["results"]) == 4
    for r in res["results"]:
        assert "sharpe" in r
        assert "total_return" in r
        assert "max_drawdown" in r

def test_vectorized_sweep_edge_cases():
    # Empty input
    res = vectorized_sweep([], "sma_crossover", {"fast": [5], "slow": [10]})
    assert res["results"] == []
    assert res["warning"] == "insufficient data"
    
    # Short input
    res = vectorized_sweep([{"close": 10}] * 10, "sma_crossover", {"fast": [5], "slow": [10]})
    assert res["results"] == []
    assert res["warning"] == "insufficient data"
    
    # Invalid slow/fast
    res = vectorized_sweep([{"close": i} for i in range(100)], "sma_crossover", {"fast": [20], "slow": [10]})
    assert res["n_combos"] == 0
    assert res["results"] == []

def test_vectorized_sweep_skips_non_positive_windows():
    prices = [{"close": 100 + i + np.sin(i)} for i in range(100)]
    sma = vectorized_sweep(prices, "sma_crossover", {"fast": [0, 5], "slow": [20]})
    assert [r["params"]["fast"] for r in sma["results"]] == [5]
    rsi = vectorized_sweep(prices, "rsi_threshold", {"period": [0, 14], "oversold": [30], "overbought": [70]})
    assert [r["params"]["period"] for r in rsi["results"]] == [14]
