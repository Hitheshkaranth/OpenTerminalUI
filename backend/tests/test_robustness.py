from __future__ import annotations

import numpy as np
import pytest

from backend.api.routes.model_lab_robustness import equity_curve_to_returns
from backend.robustness.scorecard import compute_robustness


def test_strong_positive_drift_low_vol_series_is_robust() -> None:
    rng = np.random.default_rng(7)
    returns = rng.normal(0.0015, 0.003, size=504)

    result = compute_robustness(returns, bootstrap_paths=300, seed=1)

    assert result["annual_sharpe"] > 1.0
    assert result["psr"] > 0.95
    assert result["verdict"] == "robust"


def test_pure_noise_is_not_robust() -> None:
    rng = np.random.default_rng(11)
    returns = rng.normal(0.0, 0.01, size=504)

    result = compute_robustness(returns, bootstrap_paths=300, seed=2)

    assert 0.2 <= result["psr"] <= 0.8
    assert result["verdict"] != "robust"


def test_many_trials_deflates_marginal_sharpe_confidence() -> None:
    rng = np.random.default_rng(13)
    returns = rng.normal(0.00025, 0.01, size=756)

    result = compute_robustness(returns, num_trials=500, bootstrap_paths=300, seed=3)

    assert result["dsr"] < result["psr"]


def test_short_series_is_insufficient_without_exception() -> None:
    rng = np.random.default_rng(17)
    returns = rng.normal(0.001, 0.01, size=30)

    result = compute_robustness(returns, bootstrap_paths=100, seed=4)

    assert result["verdict"] == "insufficient"


def test_bootstrap_confidence_interval_and_probability_bounds() -> None:
    rng = np.random.default_rng(19)
    returns = rng.normal(0.0008, 0.008, size=252)

    result = compute_robustness(returns, bootstrap_paths=300, seed=5)
    sharpe = result["bootstrap"]["sharpe"]

    assert sharpe["ci_low"] <= sharpe["mean"] <= sharpe["ci_high"]
    assert 0.0 <= sharpe["p_positive"] <= 1.0


def test_result_contains_required_contract_keys() -> None:
    rng = np.random.default_rng(21)
    returns = rng.normal(0.0008, 0.008, size=252)

    result = compute_robustness(returns, bootstrap_paths=300, seed=5)

    assert {
        "n_periods",
        "annual_sharpe",
        "skew",
        "kurtosis",
        "psr",
        "dsr",
        "min_track_record_length",
        "bootstrap",
        "stability",
        "verdict",
        "verdict_reasons",
    }.issubset(result)
    assert result["n_periods"] == 252
    assert result["kurtosis"] == result["excess_kurtosis"]

    bootstrap = result["bootstrap"]
    assert bootstrap is not None
    assert {"method", "paths", "sharpe", "cagr", "max_drawdown", "sortino"}.issubset(bootstrap)
    assert bootstrap["paths"] == 300
    for metric in ("sharpe", "cagr", "max_drawdown", "sortino"):
        assert {"mean", "ci_low", "ci_high", "p_positive"} == set(bootstrap[metric])

    assert "rolling_window" in result["stability"]


def test_determinism_with_same_seed() -> None:
    rng = np.random.default_rng(23)
    returns = rng.normal(0.0008, 0.008, size=252)

    first = compute_robustness(returns, bootstrap_paths=300, seed=6)
    second = compute_robustness(returns, bootstrap_paths=300, seed=6)

    assert first["psr"] == second["psr"]
    assert first["dsr"] == second["dsr"]
    assert first["bootstrap"]["sharpe"]["mean"] == second["bootstrap"]["sharpe"]["mean"]


def test_equity_curve_to_returns_extraction() -> None:
    returns = equity_curve_to_returns([{"value": 100}, {"value": 110}, {"value": 99}])

    assert returns == pytest.approx([0.1, -0.1])


def test_max_drawdown_total_wipeout_is_minus_one_not_nan():
    import numpy as np

    from backend.robustness.scorecard import _max_drawdown

    assert _max_drawdown(np.array([-1.0, 0.1])) == -1.0
