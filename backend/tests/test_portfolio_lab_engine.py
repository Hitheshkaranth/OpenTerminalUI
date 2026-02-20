from __future__ import annotations

import numpy as np
import pandas as pd

from backend.portfolio_lab.engine import run_portfolio_engine


def _synthetic_returns() -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=80, freq="D")
    rng = np.random.default_rng(42)
    mean = np.array([0.0003, 0.0003, 0.0003])
    cov = np.array(
        [
            [1.0e-5, 6.0e-6, 4.0e-6],
            [6.0e-6, 9.0e-5, 7.0e-6],
            [4.0e-6, 7.0e-6, 4.0e-5],
        ]
    )
    samples = rng.multivariate_normal(mean=mean, cov=cov, size=len(idx))
    return pd.DataFrame({"LOW": samples[:, 0], "HIGH": samples[:, 1], "MID": samples[:, 2]}, index=idx)


def test_equal_weight_method() -> None:
    returns = _synthetic_returns()
    out = run_portfolio_engine(returns, rebalance_frequency="DAILY", weighting_method="EQUAL", max_weight=0.5)
    latest = out.weights_over_time[-1]["weights"]
    assert abs(latest["LOW"] - latest["HIGH"]) < 1e-6
    assert abs(latest["HIGH"] - latest["MID"]) < 1e-6


def test_vol_target_reduces_high_vol_weight() -> None:
    returns = _synthetic_returns()
    out = run_portfolio_engine(returns, rebalance_frequency="DAILY", weighting_method="VOL_TARGET", max_weight=0.7)
    latest = out.weights_over_time[-1]["weights"]
    assert latest["HIGH"] < latest["LOW"]


def test_risk_parity_contributions_approximately_equal() -> None:
    returns = _synthetic_returns()
    out = run_portfolio_engine(returns, rebalance_frequency="DAILY", weighting_method="RISK_PARITY", max_weight=0.8)
    latest = out.weights_over_time[-1]["weights"]
    w = np.array([latest["LOW"], latest["HIGH"], latest["MID"]], dtype=float)
    cov = returns.cov().to_numpy(dtype=float) + np.eye(3) * 1e-6
    port_var = float(w.T @ cov @ w)
    assert port_var > 0
    mrc = cov @ w
    rc = w * mrc / np.sqrt(port_var)
    rc = rc / np.sum(rc)
    assert float(np.max(rc) - np.min(rc)) < 0.55
