import numpy as np
import pandas as pd
import pytest
from backend.core.riskfolio import (
    estimate_covariance, risk_parity_weights, cluster_assets, nco_weights,
    optimize_portfolio, list_methods
)

@pytest.fixture
def sample_returns():
    np.random.seed(42)
    n_days = 500
    n_assets = 6
    symbols = [f"ASSET_{i}" for i in range(n_assets)]
    
    # Create some correlation
    returns = np.random.normal(0.0005, 0.01, (n_days, n_assets))
    returns[:, 0] = returns[:, 1] * 0.8 + np.random.normal(0, 0.005, n_days)
    returns[:, 2] = returns[:, 3] * 0.5 + np.random.normal(0, 0.005, n_days)
    
    return pd.DataFrame(returns, columns=symbols)

def test_estimate_covariance(sample_returns):
    methods = ["sample", "ledoit_wolf", "ewma", "gerber"]
    n = sample_returns.shape[1]
    
    for method in methods:
        cov = estimate_covariance(sample_returns, method=method)
        assert cov.shape == (n, n)
        assert np.allclose(cov, cov.T)
        assert np.all(np.isfinite(cov))
        # PSD check: all eigenvalues >= -1e-12 (to account for numerical precision)
        vals = np.linalg.eigvals(cov)
        assert np.all(vals >= -1e-12)

def test_risk_parity_weights(sample_returns):
    weights = risk_parity_weights(sample_returns)
    symbols = sample_returns.columns.tolist()
    
    assert len(weights) == len(symbols)
    assert pytest.approx(sum(weights.values()), abs=1e-5) == 1.0
    for w in weights.values():
        assert 0.0 <= w <= 1.0
        
    # Check risk contributions are more equal than equal weight
    cov = estimate_covariance(sample_returns)
    
    def get_rc_std(w_dict):
        w = np.array([w_dict[s] for s in symbols])
        rc = w * (cov @ w)
        rc_norm = rc / np.sum(rc)
        return np.std(rc_norm)
    
    ew_weights = {s: 1.0 / len(symbols) for s in symbols}
    std_rp = get_rc_std(weights)
    std_ew = get_rc_std(ew_weights)
    
    assert std_rp < std_ew

def test_cluster_assets(sample_returns):
    result = cluster_assets(sample_returns)
    symbols = sample_returns.columns.tolist()
    
    assert "leaf_order" in result
    assert "groups" in result
    assert "linkage" in result
    
    assert set(result["leaf_order"]) == set(symbols)
    
    all_grouped_symbols = []
    for group in result["groups"]:
        all_grouped_symbols.extend(group["symbols"])
    assert set(all_grouped_symbols) == set(symbols)
    assert len(all_grouped_symbols) == len(symbols)

def test_nco_weights(sample_returns):
    weights = nco_weights(sample_returns)
    symbols = sample_returns.columns.tolist()
    
    assert len(weights) == len(symbols)
    assert pytest.approx(sum(weights.values()), abs=1e-5) == 1.0
    for w in weights.values():
        assert w >= -1e-12 # allow for tiny rounding

def test_optimize_portfolio_new_models(sample_returns):
    # Test RP
    res_rp = optimize_portfolio(sample_returns, model="RP")
    assert res_rp["model"] == "RP"
    assert pytest.approx(sum(res_rp["weights"].values()), abs=1e-5) == 1.0
    assert "metrics" in res_rp
    
    # Test NCO
    res_nco = optimize_portfolio(sample_returns, model="NCO")
    assert res_nco["model"] == "NCO"
    assert pytest.approx(sum(res_nco["weights"].values()), abs=1e-5) == 1.0
    assert "metrics" in res_nco

def test_optimize_portfolio_cov_methods(sample_returns):
    res = optimize_portfolio(sample_returns, cov_method="ledoit_wolf")
    assert pytest.approx(sum(res["weights"].values()), abs=1e-5) == 1.0
    assert res["model"] == "Classic"

def test_list_methods_updated():
    methods = list_methods()
    
    model_ids = [m["id"] for m in methods["models"]]
    assert "RP" in model_ids
    assert "NCO" in model_ids
    
    assert "covariance_methods" in methods
    cov_ids = [c["id"] for c in methods["covariance_methods"]]
    assert "sample" in cov_ids
    assert "ledoit_wolf" in cov_ids
    assert "ewma" in cov_ids
    assert "gerber" in cov_ids
