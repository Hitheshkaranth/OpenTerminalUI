import pytest
import numpy as np
import pandas as pd
from backend.core.riskfolio import (
    list_methods, risk_report, optimize_portfolio, efficient_frontier, hrp_weights
)

@pytest.fixture
def synthetic_returns():
    np.random.seed(42)
    n_days = 500
    n_assets = 6
    symbols = [f"SYM{i}" for i in range(n_assets)]
    
    # Generate random returns with some drift and volatility
    drifts = np.array([0.0001, 0.0002, 0.0003, 0.0004, 0.0005, 0.0006])
    vols = np.array([0.01, 0.012, 0.015, 0.02, 0.025, 0.03])
    
    returns = np.random.randn(n_days, n_assets) * vols + drifts
    df = pd.DataFrame(returns, columns=symbols)
    df.index = pd.bdate_range(start="2020-01-01", periods=n_days)
    return df

def test_list_methods():
    methods = list_methods()
    assert "objectives" in methods
    assert "risk_measures" in methods
    assert "models" in methods
    assert len(methods["objectives"]) > 0
    assert all("id" in m and "label" in m for m in methods["objectives"])

def test_risk_report(synthetic_returns):
    s = synthetic_returns["SYM0"]
    report = risk_report(s)
    
    required_keys = [
        "expected_return", "volatility", "downside_deviation", "mad", "var", "cvar", "evar",
        "max_drawdown", "avg_drawdown", "ulcer_index", "cdar", "edar", "sharpe", "sortino", 
        "calmar", "skew", "kurtosis"
    ]
    for key in required_keys:
        assert key in report
        assert isinstance(report[key], float)
        assert np.isfinite(report[key])

    assert report["var"] <= report["cvar"]
    assert report["max_drawdown"] >= 0

def test_optimize_classic_min_risk(synthetic_returns):
    res = optimize_portfolio(synthetic_returns, model="Classic", objective="min_risk", risk_measure="MV")
    
    weights = res["weights"]
    total_weight = sum(weights.values())
    assert pytest.approx(total_weight, abs=1e-5) == 1.0
    
    for sym, w in weights.items():
        assert 0.0 <= w <= 1.0
        
    assert "metrics" in res
    assert "risk_contributions" in res
    assert pytest.approx(sum(res["risk_contributions"].values()), abs=1e-5) == 1.0

def test_optimize_max_sharpe(synthetic_returns):
    # Calculate equal weight sharpe
    n = len(synthetic_returns.columns)
    w_eq = np.ones(n) / n
    ret_eq = synthetic_returns @ w_eq
    metrics_eq = risk_report(ret_eq)
    
    res = optimize_portfolio(synthetic_returns, objective="max_sharpe")
    
    assert res["metrics"]["sharpe"] >= metrics_eq["sharpe"] - 1e-5
    assert pytest.approx(sum(res["weights"].values()), abs=1e-5) == 1.0

def test_optimize_hrp(synthetic_returns):
    res = optimize_portfolio(synthetic_returns, model="HRP")
    assert pytest.approx(sum(res["weights"].values()), abs=1e-5) == 1.0
    assert all(w >= 0 for w in res["weights"].values())

def test_optimize_bl(synthetic_returns):
    views = [{"assets": ["SYM0"], "weights": [1.0], "value": 0.20}]
    res = optimize_portfolio(synthetic_returns, model="BL", views=views)
    assert pytest.approx(sum(res["weights"].values()), abs=1e-5) == 1.0
    assert "metrics" in res

def test_optimize_cvar(synthetic_returns):
    res = optimize_portfolio(synthetic_returns, risk_measure="CVaR", objective="min_risk")
    assert pytest.approx(sum(res["weights"].values()), abs=1e-5) == 1.0
    assert all(w >= -1e-7 for w in res["weights"].values())

def test_efficient_frontier(synthetic_returns):
    frontier = efficient_frontier(synthetic_returns, points=10)
    assert len(frontier) > 0
    # The frontier must NOT collapse to a single point: max_return objective must beat
    # min_risk's return so the target-return sweep yields a real curve (regression guard).
    assert len(frontier) >= 5, f"frontier collapsed to {len(frontier)} point(s)"
    returns = [p["return"] for p in frontier]
    assert max(returns) - min(returns) > 1e-4, "frontier has no return spread"
    # Check if sorted by risk
    risks = [p["risk"] for p in frontier]
    assert risks == sorted(risks)
    for p in frontier:
        assert "risk" in p
        assert "return" in p
        assert "sharpe" in p


def test_max_return_concentrates(synthetic_returns):
    # max_return must move off equal weights toward the highest-mean asset(s).
    res = optimize_portfolio(synthetic_returns, objective="max_return", risk_measure="MV")
    eq_ret = optimize_portfolio(synthetic_returns, objective="min_risk")["metrics"]["expected_return"]
    assert res["metrics"]["expected_return"] >= eq_ret - 1e-9
    assert max(res["weights"].values()) > 1.0 / synthetic_returns.shape[1] + 1e-3


def test_risk_report_downside_deviation_uses_all_periods():
    from backend.core.riskfolio.risk_measures import risk_report

    returns = np.array([0.02, -0.01, 0.03, -0.02, 0.01])
    report = risk_report(returns, periods_per_year=252)
    # Hand-computed: sqrt(mean([0, 1e-4, 0, 4e-4, 0])) = sqrt(1e-4), annualised by sqrt(252).
    expected_dd = np.sqrt(1e-4) * np.sqrt(252)
    assert report["downside_deviation"] == pytest.approx(expected_dd, rel=1e-5)
    assert report["sortino"] == pytest.approx(report["expected_return"] / expected_dd, rel=1e-4)
    assert report["sortino"] > report["sharpe"]
