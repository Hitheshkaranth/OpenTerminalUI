from __future__ import annotations

from typing import Any

import numpy as np


def sigmoid(x: np.ndarray | float) -> np.ndarray | float:
    return 1.0 / (1.0 + np.exp(-x))


def jump_intensity(v: np.ndarray, a0: float, a1: float, eps: float = 1e-10) -> np.ndarray:
    safe_v = np.maximum(v, eps)
    return np.exp(a0 + (a1 * np.log(safe_v)))


def up_jump_probability(v: np.ndarray, b0: float, b1: float, eps: float = 1e-10) -> np.ndarray:
    safe_v = np.maximum(v, eps)
    return np.asarray(sigmoid(b0 + (b1 * np.log(safe_v))), dtype=float)


def _sample_jump(
    rng: np.random.Generator,
    p_up: float,
    k_plus: float,
    k_minus: float,
) -> float:
    if rng.random() <= p_up:
        return float(rng.exponential(scale=1.0 / max(k_plus, 1e-8)))
    return -float(rng.exponential(scale=1.0 / max(k_minus, 1e-8)))


def propagate_particles(
    particles: np.ndarray,
    dt: float,
    params: dict[str, Any],
    rng: np.random.Generator,
) -> np.ndarray:
    a0 = float(params["a0"])
    a1 = float(params["a1"])
    b0 = float(params["b0"])
    b1 = float(params["b1"])
    k_plus = float(params["k_plus"])
    k_minus = float(params["k_minus"])
    v_min = float(params.get("v_min", 1e-8))
    v_max = float(params.get("v_max", 4.0))
    eps = float(params.get("eps", 1e-10))

    propagated = particles.astype(float).copy()
    lam = jump_intensity(propagated, a0=a0, a1=a1, eps=eps)
    jump_counts = rng.poisson(np.maximum(lam, 0.0) * max(dt, 1e-8))

    for i, n_jumps in enumerate(jump_counts):
        if n_jumps <= 0:
            continue
        v_i = float(propagated[i])
        for _ in range(int(n_jumps)):
            p_up = float(up_jump_probability(np.asarray([v_i]), b0=b0, b1=b1, eps=eps)[0])
            z = _sample_jump(rng, p_up, k_plus, k_minus)
            v_i = float(np.clip(v_i + z, v_min, v_max))
        propagated[i] = v_i
    return propagated
