from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .particle_filter import PJVParams, run_particle_filter


PARAM_NAMES = ["a0", "a1", "b0", "b1", "k_plus", "k_minus", "mu"]
PARAM_BOUNDS: dict[str, tuple[float, float]] = {
    "a0": (-8.0, 2.0),
    "a1": (-4.0, 4.0),
    "b0": (-8.0, 8.0),
    "b1": (-8.0, 8.0),
    "k_plus": (1.0, 200.0),
    "k_minus": (1.0, 200.0),
    "mu": (-0.4, 0.4),
}


def _clip_params(values: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {}
    for name in PARAM_NAMES:
        lo, hi = PARAM_BOUNDS[name]
        out[name] = float(np.clip(values[name], lo, hi))
    return out


def _to_vector(values: dict[str, float]) -> np.ndarray:
    return np.asarray([values[name] for name in PARAM_NAMES], dtype=float)


def _from_vector(vec: np.ndarray) -> dict[str, float]:
    mapped = {name: float(vec[i]) for i, name in enumerate(PARAM_NAMES)}
    return _clip_params(mapped)


def _objective(
    vec: np.ndarray,
    returns: pd.Series,
    n_particles: int,
    seed: int,
    dt: float,
) -> float:
    p = _from_vector(vec)
    result = run_particle_filter(
        returns=returns,
        params=PJVParams(**p),
        n_particles=n_particles,
        dt=dt,
        seed=seed,
    )
    loglik = float(result["loglik"])
    if not np.isfinite(loglik):
        return 1e12
    return -loglik


def _nelder_mead(
    fn: Any,
    x0: np.ndarray,
    max_iter: int = 60,
    step: float = 0.2,
    alpha: float = 1.0,
    gamma: float = 2.0,
    rho: float = 0.5,
    sigma: float = 0.5,
) -> tuple[np.ndarray, float]:
    n = len(x0)
    simplex = [x0]
    for i in range(n):
        vertex = x0.copy()
        vertex[i] = vertex[i] + step
        simplex.append(vertex)
    simplex_arr = np.asarray(simplex, dtype=float)
    values = np.asarray([fn(x) for x in simplex_arr], dtype=float)

    for _ in range(max_iter):
        order = np.argsort(values)
        simplex_arr = simplex_arr[order]
        values = values[order]
        best = simplex_arr[0]
        worst = simplex_arr[-1]
        centroid = simplex_arr[:-1].mean(axis=0)

        reflected = centroid + alpha * (centroid - worst)
        f_reflect = fn(reflected)
        if values[0] <= f_reflect < values[-2]:
            simplex_arr[-1] = reflected
            values[-1] = f_reflect
            continue
        if f_reflect < values[0]:
            expanded = centroid + gamma * (reflected - centroid)
            f_expand = fn(expanded)
            if f_expand < f_reflect:
                simplex_arr[-1] = expanded
                values[-1] = f_expand
            else:
                simplex_arr[-1] = reflected
                values[-1] = f_reflect
            continue

        contracted = centroid + rho * (worst - centroid)
        f_contract = fn(contracted)
        if f_contract < values[-1]:
            simplex_arr[-1] = contracted
            values[-1] = f_contract
            continue

        for i in range(1, len(simplex_arr)):
            simplex_arr[i] = best + sigma * (simplex_arr[i] - best)
            values[i] = fn(simplex_arr[i])

    order = np.argsort(values)
    best_x = simplex_arr[order][0]
    best_f = float(values[order][0])
    return best_x, best_f


def fit_pjv_parameters(
    returns: pd.Series | np.ndarray,
    initial: PJVParams | None = None,
    n_particles: int = 256,
    dt: float = 1.0 / 252.0,
    seed: int = 42,
    max_iter: int = 60,
) -> dict[str, Any]:
    ret_series = (
        returns.astype(float).replace([np.inf, -np.inf], np.nan).fillna(0.0)
        if isinstance(returns, pd.Series)
        else pd.Series(np.asarray(returns, dtype=float)).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    )
    if ret_series.empty:
        params = (initial or PJVParams()).asdict()
        return {"params": params, "loglik": 0.0, "iterations": 0}

    x0_values = _clip_params((initial or PJVParams()).asdict())
    x0 = _to_vector(x0_values)
    fn = lambda x: _objective(x, ret_series, n_particles=n_particles, seed=seed, dt=dt)
    best_x, best_f = _nelder_mead(fn, x0=x0, max_iter=max_iter)
    best = _from_vector(best_x)

    return {
        "params": best,
        "loglik": float(-best_f),
        "iterations": int(max_iter),
    }
