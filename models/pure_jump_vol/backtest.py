from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _max_drawdown(equity: pd.Series) -> float:
    if equity.empty:
        return 0.0
    dd = (equity / equity.cummax()) - 1.0
    return float(dd.min())


def backtest_positions(
    frame: pd.DataFrame,
    positions: pd.Series,
    transaction_cost_bps: float = 10.0,
    slippage_bps: float = 5.0,
    position_lag: int = 1,
) -> dict[str, Any]:
    if frame.empty:
        return {
            "equity_curve": [],
            "daily_returns": [],
            "metrics": {},
        }
    close = frame["close"].astype(float)
    ret = close.pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)

    pos = positions.reindex(frame.index).fillna(0).astype(float).clip(-1, 1)
    exec_pos = pos.shift(max(position_lag, 0)).fillna(0.0)
    turnover = exec_pos.diff().abs().fillna(exec_pos.abs())
    total_cost = (transaction_cost_bps + slippage_bps) / 10000.0
    strat_ret = (exec_pos * ret) - (turnover * total_cost)
    equity = (1.0 + strat_ret).cumprod()

    daily = strat_ret.copy()
    mean_daily = float(daily.mean()) if not daily.empty else 0.0
    std_daily = float(daily.std()) if not daily.empty else 0.0
    years = max(len(daily) / 252.0, 1e-8)
    cagr = float((equity.iloc[-1] ** (1.0 / years)) - 1.0) if len(equity) else 0.0
    sharpe = float((mean_daily * 252.0) / (std_daily * np.sqrt(252.0))) if std_daily > 0 else 0.0
    max_dd = _max_drawdown(equity)
    hit_rate = float((daily > 0).mean() * 100.0) if len(daily) else 0.0
    exposure = float(exec_pos.abs().mean() * 100.0) if len(exec_pos) else 0.0
    tail_threshold = float(daily.quantile(0.05)) if len(daily) else 0.0
    tail_loss_days = int((daily <= tail_threshold).sum()) if len(daily) else 0

    metrics = {
        "cagr": round(cagr, 6),
        "sharpe": round(sharpe, 6),
        "max_drawdown": round(max_dd, 6),
        "turnover": round(float(turnover.sum()), 6),
        "hit_rate": round(hit_rate, 4),
        "exposure": round(exposure, 4),
        "tail_loss_days": tail_loss_days,
        "final_equity": round(float(equity.iloc[-1]), 6),
    }
    out_curve = [
        {
            "date": str(frame.iloc[i]["date"]),
            "equity": round(float(equity.iloc[i]), 8),
            "position": float(exec_pos.iloc[i]),
            "return": round(float(daily.iloc[i]), 8),
        }
        for i in range(len(frame))
    ]
    return {
        "equity_curve": out_curve,
        "daily_returns": [round(float(x), 8) for x in daily.to_numpy(dtype=float)],
        "metrics": metrics,
    }
