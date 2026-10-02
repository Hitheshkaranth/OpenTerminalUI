from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd

from .kernel import jump_intensity, propagate_particles


@dataclass(frozen=True)
class PJVParams:
    a0: float = -2.2
    a1: float = 0.5
    b0: float = 0.0
    b1: float = -0.2
    k_plus: float = 18.0
    k_minus: float = 14.0
    mu: float = 0.0
    eps: float = 1e-10
    v_min: float = 1e-8
    v_max: float = 4.0

    def asdict(self) -> dict[str, float]:
        return {k: float(v) for k, v in asdict(self).items()}


def _systematic_resample(
    particles: np.ndarray,
    weights: np.ndarray,
    rng: np.random.Generator,
) -> np.ndarray:
    n = len(particles)
    if n == 0:
        return particles
    positions = (rng.random() + np.arange(n)) / n
    cumsum = np.cumsum(weights)
    cumsum[-1] = 1.0
    idx = np.searchsorted(cumsum, positions)
    return particles[idx]


def _normal_likelihood(r_t: float, mu_dt: float, var_dt: np.ndarray) -> np.ndarray:
    safe_var = np.maximum(var_dt, 1e-12)
    denom = np.sqrt(2.0 * np.pi * safe_var)
    expo = -0.5 * ((r_t - mu_dt) ** 2) / safe_var
    return np.exp(expo) / denom


def run_particle_filter(
    returns: pd.Series | np.ndarray,
    params: PJVParams | dict[str, Any],
    n_particles: int = 256,
    dt: float = 1.0 / 252.0,
    seed: int = 42,
    v0: float | None = None,
) -> dict[str, Any]:
    if n_particles <= 0:
        raise ValueError("n_particles must be positive")
    ret_series = (
        returns.astype(float).replace([np.inf, -np.inf], np.nan).fillna(0.0)
        if isinstance(returns, pd.Series)
        else pd.Series(np.asarray(returns, dtype=float)).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    )
    p = params.asdict() if isinstance(params, PJVParams) else {k: float(v) for k, v in params.items()}
    p.setdefault("eps", 1e-10)
    p.setdefault("v_min", 1e-8)
    p.setdefault("v_max", 4.0)
    p["k_plus"] = max(p.get("k_plus", 1.0), 1e-6)
    p["k_minus"] = max(p.get("k_minus", 1.0), 1e-6)
    p["v_max"] = max(p["v_max"], p["v_min"] + 1e-6)

    rng = np.random.default_rng(seed)
    var_seed = float(max((ret_series.var() if len(ret_series) > 1 else 1e-4), p["v_min"]))
    initial_v = float(v0) if v0 is not None else var_seed
    initial_v = float(np.clip(initial_v, p["v_min"], p["v_max"]))
    particles = np.full(n_particles, initial_v, dtype=float)
    particles += rng.normal(0.0, max(initial_v * 0.05, 1e-6), size=n_particles)
    particles = np.clip(particles, p["v_min"], p["v_max"])
    weights = np.full(n_particles, 1.0 / n_particles, dtype=float)

    v_hat: list[float] = []
    lam_hat: list[float] = []
    loglik = 0.0
    mu_dt = float(p.get("mu", 0.0)) * dt

    for r_t in ret_series.to_numpy(dtype=float):
        particles = propagate_particles(particles, dt=dt, params=p, rng=rng)
        var_dt = np.maximum(particles * dt, 1e-12)
        likelihood = _normal_likelihood(float(r_t), mu_dt=mu_dt, var_dt=var_dt)
        weighted = weights * np.maximum(likelihood, 1e-32)
        norm = float(weighted.sum())
        if norm <= 0 or not np.isfinite(norm):
            weights = np.full(n_particles, 1.0 / n_particles, dtype=float)
            loglik += np.log(1e-32)
        else:
            weights = weighted / norm
            loglik += np.log(norm + 1e-32)
        lam = jump_intensity(particles, p["a0"], p["a1"], p["eps"])
        v_hat.append(float(np.average(particles, weights=weights)))
        lam_hat.append(float(np.average(lam, weights=weights)))
        particles = _systematic_resample(particles, weights, rng)
        weights.fill(1.0 / n_particles)

    return {
        "v_hat": np.asarray(v_hat, dtype=float),
        "lambda_hat": np.asarray(lam_hat, dtype=float),
        "loglik": float(loglik),
        "params": p,
    }
