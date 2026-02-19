from __future__ import annotations

from typing import Any

import numpy as np


def _max_drawdown(values: np.ndarray) -> float:
    if values.size == 0:
        return 0.0
    peaks = np.maximum.accumulate(values)
    drawdowns = (values / np.where(peaks == 0, 1.0, peaks)) - 1.0
    return float(np.min(drawdowns))


def run_monte_carlo_simulation(
    daily_returns: list[float],
    initial_equity: float,
    simulations: int = 500,
    horizon_days: int | None = None,
    seed: int = 42,
) -> dict[str, Any]:
    if simulations < 10:
        raise ValueError("simulations must be >= 10")
    clean_returns = np.array([float(x) for x in daily_returns if np.isfinite(x)], dtype=float)
    if clean_returns.size == 0:
        return {
            "simulations": 0,
            "horizon_days": 0,
            "terminal_equity": [],
            "max_drawdown": [],
            "percentiles": {"p5": 0.0, "p50": 0.0, "p95": 0.0},
        }
    days = int(horizon_days or min(252, clean_returns.size))
    days = max(5, days)
    rng = np.random.default_rng(seed)
    terminals: list[float] = []
    max_dds: list[float] = []
    for _ in range(simulations):
        sampled = rng.choice(clean_returns, size=days, replace=True)
        path = float(initial_equity) * np.cumprod(1.0 + sampled)
        terminals.append(float(path[-1]))
        max_dds.append(_max_drawdown(path))
    terminal_arr = np.array(terminals, dtype=float)
    return {
        "simulations": simulations,
        "horizon_days": days,
        "terminal_equity": [round(float(x), 4) for x in terminals],
        "max_drawdown": [round(float(x), 6) for x in max_dds],
        "percentiles": {
            "p5": round(float(np.percentile(terminal_arr, 5)), 4),
            "p50": round(float(np.percentile(terminal_arr, 50)), 4),
            "p95": round(float(np.percentile(terminal_arr, 95)), 4),
        },
    }
