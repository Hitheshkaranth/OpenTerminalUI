from __future__ import annotations

import numpy as np

from models.pure_jump_vol.backtest import backtest_positions
from models.pure_jump_vol.fit import fit_pjv_parameters
from models.pure_jump_vol.particle_filter import PJVParams, run_particle_filter
from models.pure_jump_vol.signals import generate_pjv_signals
from models.pure_jump_vol.synthetic import simulate_pure_jump_path


def test_particle_filter_outputs_finite_values() -> None:
    sim = simulate_pure_jump_path(n_steps=220, seed=11)
    returns = sim["frame"]["close"].pct_change().fillna(0.0)
    out = run_particle_filter(returns=returns, params=PJVParams(), n_particles=128, seed=5)
    assert len(out["v_hat"]) == len(returns)
    assert len(out["lambda_hat"]) == len(returns)
    assert np.isfinite(out["v_hat"]).all()
    assert np.isfinite(out["lambda_hat"]).all()
    assert np.isfinite(out["loglik"])


def test_fit_improves_objective_over_default() -> None:
    sim = simulate_pure_jump_path(n_steps=240, seed=9, params=PJVParams(a0=-2.0, a1=0.6, b0=0.1, b1=-0.3))
    returns = sim["frame"]["close"].pct_change().fillna(0.0)
    base = run_particle_filter(returns=returns, params=PJVParams(), n_particles=96, seed=7)
    fitted = fit_pjv_parameters(returns=returns, n_particles=96, seed=7, max_iter=16)
    assert "params" in fitted
    assert np.isfinite(fitted["loglik"])
    assert float(fitted["loglik"]) >= float(base["loglik"]) - 1e-6


def test_signal_output_domain() -> None:
    sim = simulate_pure_jump_path(n_steps=320, seed=3)
    frame = sim["frame"][["date", "open", "high", "low", "close", "volume"]].copy()
    signals, diagnostics = generate_pjv_signals(frame, {"lookback": 120, "n_particles": 96, "seed": 1})
    assert len(signals) == len(frame)
    assert set(int(v) for v in signals.tolist()).issubset({-1, 0, 1})
    assert "stress" in diagnostics
    assert len(diagnostics["stress"]) == len(frame)


def test_backtest_metrics_stable() -> None:
    sim = simulate_pure_jump_path(n_steps=280, seed=17)
    frame = sim["frame"][["date", "open", "high", "low", "close", "volume"]].copy()
    signals, _ = generate_pjv_signals(frame, {"lookback": 100, "n_particles": 64, "seed": 17})
    result = backtest_positions(frame=frame, positions=signals, transaction_cost_bps=8.0, slippage_bps=4.0, position_lag=1)
    metrics = result["metrics"]
    assert isinstance(metrics, dict)
    for key in ["cagr", "sharpe", "max_drawdown", "turnover", "hit_rate", "exposure", "tail_loss_days", "final_equity"]:
        assert key in metrics
    assert np.isfinite(float(metrics["final_equity"]))
    assert len(result["equity_curve"]) == len(frame)
