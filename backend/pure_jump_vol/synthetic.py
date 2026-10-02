from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .kernel import jump_intensity, propagate_particles
from .particle_filter import PJVParams


def simulate_pure_jump_path(
    n_steps: int = 400,
    params: PJVParams | None = None,
    seed: int = 7,
    dt: float = 1.0 / 252.0,
    initial_price: float = 100.0,
    initial_v: float = 0.04,
) -> dict[str, Any]:
    p = (params or PJVParams()).asdict()
    rng = np.random.default_rng(seed)
    v = float(np.clip(initial_v, p["v_min"], p["v_max"]))
    prices = [initial_price]
    vols = [v]
    lams = [float(jump_intensity(np.asarray([v]), p["a0"], p["a1"], p["eps"])[0])]
    rets = [0.0]

    for _ in range(1, n_steps):
        propagated = propagate_particles(np.asarray([v], dtype=float), dt=dt, params=p, rng=rng)
        v = float(propagated[0])
        ret = float(rng.normal(loc=p["mu"] * dt, scale=np.sqrt(max(v * dt, 1e-12))))
        next_price = prices[-1] * (1.0 + ret)
        prices.append(float(next_price))
        vols.append(v)
        lams.append(float(jump_intensity(np.asarray([v]), p["a0"], p["a1"], p["eps"])[0]))
        rets.append(ret)

    frame = pd.DataFrame(
        {
            "date": pd.date_range("2020-01-01", periods=n_steps, freq="D"),
            "open": prices,
            "high": np.asarray(prices) * 1.01,
            "low": np.asarray(prices) * 0.99,
            "close": prices,
            "volume": 1_000_000,
            "ret": rets,
            "v_true": vols,
            "lambda_true": lams,
        }
    )
    return {"frame": frame, "params": p}
