from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .particle_filter import PJVParams, run_particle_filter


def _zscore(series: pd.Series, lookback: int) -> pd.Series:
    mean = series.rolling(lookback, min_periods=max(20, lookback // 4)).mean()
    std = series.rolling(lookback, min_periods=max(20, lookback // 4)).std()
    z = (series - mean) / std.replace(0, np.nan)
    return z.replace([np.inf, -np.inf], np.nan).fillna(0.0)


def generate_pjv_signals(
    frame: pd.DataFrame,
    context: dict[str, Any] | None = None,
) -> tuple[pd.Series, dict[str, Any]]:
    ctx = context or {}
    close = frame["close"].astype(float).replace([np.inf, -np.inf], np.nan).ffill().bfill()
    returns = close.pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)

    params = PJVParams(
        a0=float(ctx.get("a0", -2.2)),
        a1=float(ctx.get("a1", 0.5)),
        b0=float(ctx.get("b0", 0.0)),
        b1=float(ctx.get("b1", -0.2)),
        k_plus=float(ctx.get("k_plus", 18.0)),
        k_minus=float(ctx.get("k_minus", 14.0)),
        mu=float(ctx.get("mu", 0.0)),
        eps=float(ctx.get("eps", 1e-10)),
        v_min=float(ctx.get("v_min", 1e-8)),
        v_max=float(ctx.get("v_max", 4.0)),
    )
    n_particles = int(ctx.get("n_particles", 256))
    seed = int(ctx.get("seed", 42))
    lookback = int(ctx.get("lookback", 252))
    stress_exit = float(ctx.get("stress_exit", 1.5))
    stress_entry = float(ctx.get("stress_entry", 0.5))
    hold_logic = str(ctx.get("hold_logic", "hold")).lower().strip()

    filt = run_particle_filter(
        returns=returns,
        params=params,
        n_particles=max(32, n_particles),
        seed=seed,
    )
    v_hat = pd.Series(filt["v_hat"], index=frame.index, dtype=float).ffill().fillna(0.0)
    lam_hat = pd.Series(filt["lambda_hat"], index=frame.index, dtype=float).ffill().fillna(0.0)

    stress = _zscore(v_hat, lookback=lookback) + _zscore(lam_hat, lookback=lookback)
    sma50 = close.rolling(50, min_periods=50).mean()
    sma200 = close.rolling(200, min_periods=200).mean()
    trend = np.sign((sma50 - sma200).fillna(0.0))

    out = pd.Series(0, index=frame.index, dtype=int)
    current = 0
    for i in range(len(frame)):
        s = float(stress.iloc[i])
        t = float(trend.iloc[i])
        if s > stress_exit:
            current = 0
        elif t > 0 and s < stress_entry:
            current = 1
        elif hold_logic == "flat":
            current = 0
        out.iloc[i] = int(current)

    diagnostics = {
        "stress": stress.fillna(0.0).to_numpy(dtype=float),
        "trend": trend.fillna(0.0).to_numpy(dtype=float),
        "v_hat": v_hat.to_numpy(dtype=float),
        "lambda_hat": lam_hat.to_numpy(dtype=float),
    }
    return out.fillna(0).astype(int), diagnostics
