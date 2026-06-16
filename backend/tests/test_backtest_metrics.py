import numpy as np
import pandas as pd
import pytest
from backend.core.backtest_metrics import (
    compute_performance_metrics,
    compute_scenario_projections,
    compute_benchmark_comparison
)

def test_metrics_robustness():
    # Empty input
    perf = compute_performance_metrics([])
    assert perf["n_obs"] == 0
    assert perf["cagr"] == 0.0
    
    scen = compute_scenario_projections([])
    assert scen["scenarios"] == []
    
    bench = compute_benchmark_comparison([], [])
    assert bench["n_obs"] == 0
    assert bench["beta"] == 0.0

def test_metrics_synthetic_data():
    rng = np.random.default_rng(7)
    n_days = 400
    dates = pd.date_range("2020-01-01", periods=n_days)
    
    # Geometric Brownian Motion-ish
    returns = rng.normal(0.002, 0.01, n_days)
    equity = 10000 * np.exp(np.cumsum(returns))
    
    equity_curve = [
        {"date": d.strftime("%Y-%m-%d"), "equity": float(e)}
        for d, e in zip(dates, equity)
    ]
    
    # Performance Metrics
    perf = compute_performance_metrics(equity_curve)
    
    expected_keys = [
        "total_return", "years", "cagr", "volatility",
        "downside_deviation", "sharpe", "sortino", "max_drawdown",
        "calmar", "recovery_factor", "ulcer_index", "var_95",
        "cvar_95", "omega_ratio", "tail_ratio", "skew",
        "kurtosis", "best_day", "worst_day", "win_rate_days",
        "avg_up_day", "avg_down_day", "best_month", "worst_month",
        "positive_months_pct", "avg_month", "n_obs"
    ]
    for key in expected_keys:
        assert key in perf
        
    assert perf["n_obs"] == n_days - 1
    assert perf["cagr"] > 0
    assert perf["volatility"] > 0
    assert -1 <= perf["max_drawdown"] <= 0
    assert np.isfinite(perf["sharpe"])
    
    # Scenario Projections
    scen = compute_scenario_projections(equity_curve)
    assert len(scen["scenarios"]) == 5
    
    # Check descending order
    returns_pct = [s["return_pct"] for s in scen["scenarios"]]
    assert returns_pct == sorted(returns_pct, reverse=True)
    
    # Benchmark Comparison (Self)
    bench = compute_benchmark_comparison(equity_curve, equity_curve)
    assert abs(bench["correlation"] - 1.0) < 1e-6
    assert abs(bench["beta"] - 1.0) < 0.05
    assert bench["n_obs"] == n_days - 1
    assert bench["strategy_cagr"] == perf["cagr"]

if __name__ == "__main__":
    pytest.main([__file__])
