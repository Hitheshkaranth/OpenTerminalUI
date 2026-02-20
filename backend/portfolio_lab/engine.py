from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class PortfolioEngineResult:
    weights_over_time: list[dict]
    returns_series: list[dict]
    turnover_series: list[dict]
    contribution_series: list[dict]
    correlation_matrix: dict


def _normalize_with_cap(weights: np.ndarray, cap: float) -> np.ndarray:
    if weights.size == 0:
        return weights
    clipped = np.clip(weights, 0.0, cap)
    total = float(np.sum(clipped))
    if total <= 0:
        return np.ones_like(clipped) / len(clipped)
    return clipped / total


def _equal_weights(n: int, cap: float) -> np.ndarray:
    if n <= 0:
        return np.array([], dtype=float)
    return _normalize_with_cap(np.ones(n, dtype=float) / n, cap)


def _vol_target_weights(window_returns: pd.DataFrame, cap: float) -> np.ndarray:
    vol = window_returns.std(ddof=0).replace(0.0, np.nan).fillna(1.0)
    inv = (1.0 / vol).to_numpy(dtype=float)
    inv = np.nan_to_num(inv, nan=0.0, posinf=0.0, neginf=0.0)
    if np.sum(inv) <= 0:
        return _equal_weights(window_returns.shape[1], cap)
    w = inv / np.sum(inv)
    return _normalize_with_cap(w, cap)


def _risk_contributions(weights: np.ndarray, cov: np.ndarray) -> np.ndarray:
    port_var = float(weights.T @ cov @ weights)
    if port_var <= 0:
        return np.zeros_like(weights)
    mrc = cov @ weights
    rc = weights * mrc / np.sqrt(port_var)
    return rc


def _risk_parity_weights(window_returns: pd.DataFrame, cap: float) -> np.ndarray:
    n = window_returns.shape[1]
    if n == 0:
        return np.array([], dtype=float)
    if window_returns.shape[0] < 5:
        return _equal_weights(n, cap)
    cov = window_returns.cov().to_numpy(dtype=float)
    if cov.shape != (n, n):
        return _equal_weights(n, cap)

    cov = np.nan_to_num(cov, nan=0.0)
    cov = cov + np.eye(n) * 1e-6

    w = _vol_target_weights(window_returns, cap)
    target = np.ones(n, dtype=float) / n

    for _ in range(200):
        prev = w.copy()
        for i in range(n):
            sigma = float(np.sqrt(max(1e-12, w.T @ cov @ w)))
            mrc = float((cov @ w)[i])
            if abs(mrc) < 1e-12:
                continue
            w[i] = max(1e-10, target[i] * sigma / mrc)
            w = _normalize_with_cap(w, cap)
        if not np.all(np.isfinite(w)):
            break
        if float(np.max(np.abs(prev - w))) < 1e-6:
            break

    return _normalize_with_cap(w, cap)


def run_portfolio_engine(
    asset_returns: pd.DataFrame,
    *,
    rebalance_frequency: str = "WEEKLY",
    weighting_method: str = "EQUAL",
    max_weight: float = 0.25,
    cash_buffer: float = 0.0,
    vol_window: int = 20,
) -> PortfolioEngineResult:
    if asset_returns.empty:
        return PortfolioEngineResult([], [], [], [], {"labels": [], "values": [], "cluster_order": []})

    returns = asset_returns.copy().sort_index().dropna(how="all")
    returns = returns.fillna(0.0)
    assets = list(returns.columns)

    if rebalance_frequency == "DAILY":
        rebalance_idx = set(returns.index)
    elif rebalance_frequency == "MONTHLY":
        rebalance_idx = set(returns.resample("ME").last().index)
    else:
        rebalance_idx = set(returns.resample("W-FRI").last().index)

    current_w = _equal_weights(len(assets), cap=max_weight)
    if cash_buffer > 0:
        current_w = current_w * max(0.0, 1.0 - cash_buffer)

    rows_weights: list[dict] = []
    rows_returns: list[dict] = []
    rows_turnover: list[dict] = []
    rows_contrib: list[dict] = []

    for idx, date in enumerate(returns.index):
        if date in rebalance_idx:
            window = returns.iloc[max(0, idx - vol_window):idx] if idx > 0 else returns.iloc[:1]
            if weighting_method == "VOL_TARGET":
                next_w = _vol_target_weights(window, cap=max_weight)
            elif weighting_method == "RISK_PARITY":
                next_w = _risk_parity_weights(window, cap=max_weight)
            else:
                next_w = _equal_weights(len(assets), cap=max_weight)

            if cash_buffer > 0:
                next_w = next_w * max(0.0, 1.0 - cash_buffer)
            turnover = float(np.sum(np.abs(next_w - current_w)))
            current_w = next_w
        else:
            turnover = 0.0

        ret_vec = returns.loc[date].to_numpy(dtype=float)
        contrib_vec = current_w * ret_vec
        port_ret = float(np.sum(contrib_vec))

        row_w = {"date": date.date().isoformat(), "weights": {assets[i]: float(current_w[i]) for i in range(len(assets))}}
        rows_weights.append(row_w)
        rows_turnover.append({"date": date.date().isoformat(), "turnover": turnover})
        rows_returns.append({"date": date.date().isoformat(), "return": port_ret})

        contrib_payload = {"date": date.date().isoformat()}
        for i, asset in enumerate(assets):
            contrib_payload[asset] = float(contrib_vec[i])
        rows_contrib.append(contrib_payload)

    corr = returns.corr().fillna(0.0)
    labels = list(corr.columns)
    values = [[float(corr.iloc[i, j]) for j in range(len(labels))] for i in range(len(labels))]
    order = sorted(range(len(labels)), key=lambda i: float(np.sum(values[i])), reverse=True)

    return PortfolioEngineResult(
        weights_over_time=rows_weights,
        returns_series=rows_returns,
        turnover_series=rows_turnover,
        contribution_series=rows_contrib,
        correlation_matrix={
            "labels": labels,
            "values": values,
            "cluster_order": order,
        },
    )
