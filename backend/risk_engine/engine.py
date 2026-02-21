from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


DEFAULT_SCENARIOS: list[dict[str, Any]] = [
    {"id": "equity_shock_-5", "name": "Equity -5%", "type": "pct", "shock": -0.05},
    {"id": "equity_shock_-10", "name": "Equity -10%", "type": "pct", "shock": -0.10},
    {"id": "vol_spike_30", "name": "Vol +30%", "type": "vol", "shock": 0.30},
    {"id": "rates_up_100bps", "name": "Rates +100bps", "type": "rates", "shock": 0.01},
]


def compute_parametric_var_es(returns: np.ndarray, confidence: float = 0.95) -> dict[str, float]:
    mu = float(np.mean(returns))
    sigma = float(np.std(returns, ddof=1)) if len(returns) > 1 else 0.0
    alpha = 1.0 - confidence
    z = float(abs(np.quantile(np.random.default_rng(42).normal(size=200000), alpha)))
    var = -(mu - z * sigma)
    # normal ES approximation
    phi = float(np.exp(-0.5 * z * z) / np.sqrt(2.0 * np.pi))
    es = -(mu - sigma * (phi / max(alpha, 1e-6)))
    return {"var": float(var), "es": float(es), "mean": mu, "volatility": sigma}


def compute_historical_var_es(returns: np.ndarray, confidence: float = 0.95) -> dict[str, float]:
    if len(returns) == 0:
        return {"var": 0.0, "es": 0.0}
    alpha = 1.0 - confidence
    q = float(np.quantile(returns, alpha))
    tail = returns[returns <= q]
    es = float(np.mean(tail)) if len(tail) else q
    return {"var": float(-q), "es": float(-es)}


def rolling_covariance(returns_df: pd.DataFrame, window: int = 60) -> list[dict[str, Any]]:
    if returns_df.empty:
        return []
    out: list[dict[str, Any]] = []
    for i in range(window, len(returns_df) + 1):
        chunk = returns_df.iloc[i - window : i]
        cov = chunk.cov().fillna(0.0)
        out.append({"date": str(chunk.index[-1]), "matrix": cov.values.tolist(), "symbols": list(cov.columns)})
    return out


def compute_factor_exposures(returns_df: pd.DataFrame, market_col: str | None = None) -> dict[str, float]:
    if returns_df.empty:
        return {"market_beta": 0.0, "momentum": 0.0, "low_vol": 0.0, "sector_tilt": 0.0}
    port = returns_df.mean(axis=1)
    market = returns_df[market_col] if market_col and market_col in returns_df.columns else returns_df.mean(axis=1)
    cov = float(np.cov(port, market)[0, 1]) if len(port) > 1 else 0.0
    var_m = float(np.var(market)) if len(market) > 1 else 0.0
    beta = cov / var_m if var_m > 0 else 0.0
    momentum = float(port.tail(20).mean() - port.head(20).mean()) if len(port) >= 40 else float(port.mean())
    low_vol = float(1.0 / max(float(port.std(ddof=1) or 1e-6), 1e-6))
    sector_tilt = float(np.clip(momentum * 0.5 + beta * 0.25, -2.0, 2.0))
    return {
        "market_beta": beta,
        "momentum": momentum,
        "low_vol": low_vol,
        "sector_tilt": sector_tilt,
    }


def stress_scenarios(portfolio_value: float, scenarios: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    selected = scenarios or DEFAULT_SCENARIOS
    out: list[dict[str, Any]] = []
    for s in selected:
        shock = float(s.get("shock") or 0.0)
        if str(s.get("type")) == "vol":
            pnl = -portfolio_value * (shock * 0.15)
        elif str(s.get("type")) == "rates":
            pnl = -portfolio_value * (shock * 1.2)
        else:
            pnl = portfolio_value * shock
        out.append({"id": s.get("id"), "name": s.get("name"), "pnl": float(pnl), "post_value": float(portfolio_value + pnl)})
    return out


def compute_portfolio_risk(returns_df: pd.DataFrame, portfolio_value: float, confidence: float = 0.95) -> dict[str, Any]:
    if returns_df.empty:
        return {
            "parametric": {"var": 0.0, "es": 0.0},
            "historical": {"var": 0.0, "es": 0.0},
            "rolling_covariance": [],
            "factor_exposures": {"market_beta": 0.0, "momentum": 0.0, "low_vol": 0.0, "sector_tilt": 0.0},
            "scenarios": stress_scenarios(portfolio_value),
        }
    port_returns = returns_df.mean(axis=1).to_numpy(dtype=float)
    param = compute_parametric_var_es(port_returns, confidence=confidence)
    hist = compute_historical_var_es(port_returns, confidence=confidence)
    return {
        "parametric": {
            "var": float(param["var"] * portfolio_value),
            "es": float(param["es"] * portfolio_value),
            "daily_return_mean": float(param["mean"]),
            "daily_volatility": float(param["volatility"]),
        },
        "historical": {
            "var": float(hist["var"] * portfolio_value),
            "es": float(hist["es"] * portfolio_value),
        },
        "rolling_covariance": rolling_covariance(returns_df, window=min(60, max(10, len(returns_df)))),
        "factor_exposures": compute_factor_exposures(returns_df),
        "scenarios": stress_scenarios(portfolio_value),
    }
