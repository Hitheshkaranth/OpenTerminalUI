from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _returns_from_equity(equity_curve: list[dict[str, Any]]) -> np.ndarray:
    if not equity_curve:
        return np.array([], dtype=float)
    values = np.array([float(item.get("equity", 0.0) or 0.0) for item in equity_curve], dtype=float)
    values = values[np.isfinite(values)]
    if values.size < 2:
        return np.array([], dtype=float)
    prev = values[:-1]
    nxt = values[1:]
    valid = prev != 0
    if not valid.any():
        return np.array([], dtype=float)
    return (nxt[valid] / prev[valid]) - 1.0


def _max_drawdown(equity: np.ndarray) -> float:
    if equity.size == 0:
        return 0.0
    peaks = np.maximum.accumulate(equity)
    peaks[peaks == 0] = np.nan
    drawdowns = (equity - peaks) / peaks
    drawdowns = np.nan_to_num(drawdowns, nan=0.0)
    return float(abs(np.min(drawdowns)))


def _rolling_metric(values: np.ndarray, window: int) -> list[float]:
    if values.size < window or window <= 1:
        return []
    series = pd.Series(values)
    roll_mean = series.rolling(window).mean() * 252.0
    roll_vol = series.rolling(window).std(ddof=0) * np.sqrt(252.0)
    out = (roll_mean / roll_vol.replace(0, np.nan)).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return [round(float(x), 6) for x in out.tolist() if pd.notna(x)]


def _align_for_beta_alpha(strategy: np.ndarray, benchmark: np.ndarray) -> tuple[float, float]:
    n = int(min(strategy.size, benchmark.size))
    if n < 2:
        return 0.0, 0.0
    s = strategy[-n:]
    b = benchmark[-n:]
    b_var = float(np.var(b))
    if b_var == 0:
        return 0.0, 0.0
    beta = float(np.cov(s, b)[0, 1] / b_var)
    alpha = float((np.mean(s) - beta * np.mean(b)) * 252.0)
    return alpha, beta


def compute_run_metrics(
    equity_curve: list[dict[str, Any]],
    trades: list[dict[str, Any]] | None = None,
    benchmark_returns: list[float] | None = None,
) -> dict[str, Any]:
    trades = trades or []
    daily_returns = _returns_from_equity(equity_curve)
    equity = np.array([float(item.get("equity", 0.0) or 0.0) for item in equity_curve], dtype=float)

    if equity.size < 2:
        return {
            "total_return": 0.0,
            "cagr": 0.0,
            "vol_annual": 0.0,
            "sharpe": 0.0,
            "sortino": 0.0,
            "max_drawdown": 0.0,
            "calmar": 0.0,
            "win_rate": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "profit_factor": 0.0,
            "turnover": 0.0,
            "alpha": 0.0,
            "beta": 0.0,
        }

    total_return = float((equity[-1] / equity[0]) - 1.0) if equity[0] else 0.0
    years = max(float(equity.size - 1) / 252.0, 1.0 / 252.0)
    cagr = float((equity[-1] / equity[0]) ** (1.0 / years) - 1.0) if equity[0] > 0 else 0.0

    mean_ret = float(np.mean(daily_returns)) if daily_returns.size else 0.0
    vol_daily = float(np.std(daily_returns, ddof=0)) if daily_returns.size else 0.0
    vol_annual = vol_daily * float(np.sqrt(252.0))
    sharpe = float((mean_ret / vol_daily) * np.sqrt(252.0)) if vol_daily > 0 else 0.0

    downside = daily_returns[daily_returns < 0]
    downside_std = float(np.std(downside, ddof=0)) if downside.size else 0.0
    sortino = float((mean_ret / downside_std) * np.sqrt(252.0)) if downside_std > 0 else 0.0

    max_dd = _max_drawdown(equity)
    calmar = float(cagr / max_dd) if max_dd > 0 else 0.0

    pnls: list[float] = []
    qty_total = 0.0
    for trade in trades:
        action = str(trade.get("action", "")).upper()
        price = float(trade.get("price", 0.0) or 0.0)
        qty = abs(float(trade.get("quantity", 0.0) or 0.0))
        qty_total += qty
        if action == "SELL":
            pnls.append(price * qty)
        elif action == "BUY":
            pnls.append(-price * qty)

    wins = [x for x in pnls if x > 0]
    losses = [x for x in pnls if x < 0]
    closed = max(len(wins) + len(losses), 1)
    win_rate = float(len(wins) / closed)
    avg_win = float(np.mean(wins)) if wins else 0.0
    avg_loss = float(np.mean(losses)) if losses else 0.0
    loss_abs_sum = abs(float(np.sum(losses))) if losses else 0.0
    profit_factor = float(float(np.sum(wins)) / loss_abs_sum) if loss_abs_sum > 0 else 0.0

    avg_equity = float(np.mean(equity)) if equity.size else 0.0
    turnover = float(qty_total / avg_equity) if avg_equity > 0 else 0.0

    alpha = 0.0
    beta = 0.0
    if benchmark_returns:
        bench = np.array([float(x) for x in benchmark_returns], dtype=float)
        alpha, beta = _align_for_beta_alpha(daily_returns, bench)

    return {
        "total_return": round(total_return, 8),
        "cagr": round(cagr, 8),
        "vol_annual": round(vol_annual, 8),
        "sharpe": round(sharpe, 8),
        "sortino": round(sortino, 8),
        "max_drawdown": round(max_dd, 8),
        "calmar": round(calmar, 8),
        "win_rate": round(win_rate, 8),
        "avg_win": round(avg_win, 8),
        "avg_loss": round(avg_loss, 8),
        "profit_factor": round(profit_factor, 8),
        "turnover": round(turnover, 8),
        "alpha": round(alpha, 8),
        "beta": round(beta, 8),
    }


def compute_run_timeseries(
    equity_curve: list[dict[str, Any]],
    benchmark_curve: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    benchmark_curve = benchmark_curve or []
    dates = [str(item.get("date", "")) for item in equity_curve]
    equity = [float(item.get("equity", 0.0) or 0.0) for item in equity_curve]

    if not equity:
        return {
            "equity_curve": [],
            "benchmark_curve": [],
            "drawdown": [],
            "underwater": [],
            "rolling_sharpe_30": [],
            "rolling_sharpe_90": [],
            "monthly_returns": [],
            "returns_histogram": {"bins": [], "counts": []},
        }

    eq_np = np.array(equity, dtype=float)
    peaks = np.maximum.accumulate(eq_np)
    peaks[peaks == 0] = np.nan
    dd = np.nan_to_num((eq_np - peaks) / peaks, nan=0.0)

    returns = _returns_from_equity(equity_curve)
    rolling_30 = _rolling_metric(returns, 30)
    rolling_90 = _rolling_metric(returns, 90)

    frame = pd.DataFrame({"date": pd.to_datetime(dates, errors="coerce"), "equity": eq_np}).dropna()
    frame = frame.set_index("date")
    monthly = []
    if not frame.empty:
        mret = frame["equity"].resample("ME").last().pct_change().dropna()
        for idx, val in mret.items():
            monthly.append({
                "year": int(idx.year),
                "month": int(idx.month),
                "return_pct": round(float(val) * 100.0, 6),
            })

    hist_bins: list[float] = []
    hist_counts: list[int] = []
    if returns.size:
        counts, bins = np.histogram(returns, bins=24)
        centers = (bins[:-1] + bins[1:]) / 2.0
        hist_bins = [round(float(x), 8) for x in centers.tolist()]
        hist_counts = [int(x) for x in counts.tolist()]

    return {
        "equity_curve": [{"date": dates[idx], "value": round(float(eq_np[idx]), 6)} for idx in range(len(eq_np))],
        "benchmark_curve": [
            {"date": str(item.get("date", "")), "value": round(float(item.get("equity", 0.0) or 0.0), 6)}
            for item in benchmark_curve
        ],
        "drawdown": [{"date": dates[idx], "value": round(float(dd[idx]), 8)} for idx in range(len(dd))],
        "underwater": [{"date": dates[idx], "value": round(float(dd[idx]), 8)} for idx in range(len(dd))],
        "rolling_sharpe_30": rolling_30,
        "rolling_sharpe_90": rolling_90,
        "monthly_returns": monthly,
        "returns_histogram": {"bins": hist_bins, "counts": hist_counts},
    }
