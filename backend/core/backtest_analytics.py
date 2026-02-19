from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _equity_frame(equity_curve: list[dict]) -> pd.DataFrame:
    if not equity_curve:
        return pd.DataFrame()
    frame = pd.DataFrame(equity_curve).copy()
    if "date" not in frame.columns or "equity" not in frame.columns:
        return pd.DataFrame()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["equity"] = pd.to_numeric(frame["equity"], errors="coerce")
    frame = frame.dropna(subset=["date", "equity"]).sort_values("date")
    if frame.empty:
        return pd.DataFrame()
    frame = frame.set_index("date")
    return frame


def compute_monthly_returns(equity_curve: list[dict]) -> list[dict]:
    frame = _equity_frame(equity_curve)
    if frame.empty:
        return []
    monthly = frame["equity"].resample("ME").last()
    monthly_ret = (monthly.pct_change() * 100).dropna()
    out: list[dict] = []
    for dt, val in monthly_ret.items():
        out.append(
            {
                "year": int(dt.year),
                "month": int(dt.month),
                "return_pct": round(float(val), 4),
            }
        )
    return out


def compute_drawdown_series(equity_curve: list[dict]) -> list[dict]:
    frame = _equity_frame(equity_curve)
    if frame.empty:
        return []
    running_max = frame["equity"].cummax().replace(0, np.nan)
    drawdown = ((frame["equity"] - running_max) / running_max) * 100.0
    drawdown = drawdown.fillna(0.0)
    out: list[dict] = []
    for dt, dd in drawdown.items():
        peak = running_max.loc[dt]
        out.append(
            {
                "date": dt.date().isoformat(),
                "drawdown_pct": round(float(dd), 4),
                "equity": round(float(frame.loc[dt, "equity"]), 4),
                "peak": round(float(peak if pd.notna(peak) else frame.loc[dt, "equity"]), 4),
            }
        )
    return out


def compute_rolling_metrics(equity_curve: list[dict], window: int = 60) -> list[dict]:
    frame = _equity_frame(equity_curve)
    if frame.empty or window <= 1:
        return []
    returns = frame["equity"].pct_change()
    rolling_mean = returns.rolling(window).mean() * 252.0
    rolling_vol = returns.rolling(window).std() * np.sqrt(252.0)
    rolling_sharpe = (rolling_mean / rolling_vol.replace(0, np.nan)).replace([np.inf, -np.inf], np.nan)
    rolling_cum_ret = frame["equity"].pct_change(window) * 100.0
    metrics = pd.DataFrame(
        {
            "rolling_sharpe": rolling_sharpe,
            "rolling_volatility": rolling_vol * 100.0,
            "rolling_return": rolling_cum_ret,
        }
    ).dropna()
    if metrics.empty:
        return []
    out: list[dict] = []
    for dt, row in metrics.iterrows():
        out.append(
            {
                "date": dt.date().isoformat(),
                "rolling_sharpe": round(float(row["rolling_sharpe"]), 4),
                "rolling_volatility": round(float(row["rolling_volatility"]), 4),
                "rolling_return": round(float(row["rolling_return"]), 4),
            }
        )
    return out


def compute_return_distribution(equity_curve: list[dict], bins: int = 50) -> dict:
    frame = _equity_frame(equity_curve)
    if frame.empty or bins <= 1:
        return {
            "bins": [],
            "counts": [],
            "stats": {
                "mean": 0.0,
                "median": 0.0,
                "std": 0.0,
                "skewness": 0.0,
                "kurtosis": 0.0,
                "min": 0.0,
                "max": 0.0,
                "var_95": 0.0,
                "var_99": 0.0,
            },
        }
    returns = (frame["equity"].pct_change() * 100.0).dropna()
    if returns.empty:
        return {
            "bins": [],
            "counts": [],
            "stats": {
                "mean": 0.0,
                "median": 0.0,
                "std": 0.0,
                "skewness": 0.0,
                "kurtosis": 0.0,
                "min": 0.0,
                "max": 0.0,
                "var_95": 0.0,
                "var_99": 0.0,
            },
        }
    counts, edges = np.histogram(returns.to_numpy(dtype=float), bins=bins)
    centers = ((edges[:-1] + edges[1:]) / 2.0).tolist()
    stats = {
        "mean": round(float(returns.mean()), 6),
        "median": round(float(returns.median()), 6),
        "std": round(float(returns.std()), 6),
        "skewness": round(float(returns.skew()), 6),
        "kurtosis": round(float(returns.kurtosis()), 6),
        "min": round(float(returns.min()), 6),
        "max": round(float(returns.max()), 6),
        "var_95": round(float(returns.quantile(0.05)), 6),
        "var_99": round(float(returns.quantile(0.01)), 6),
    }
    return {
        "bins": [round(float(x), 6) for x in centers],
        "counts": [int(x) for x in counts.tolist()],
        "stats": stats,
    }


def compute_trade_analytics(trades: list[dict], equity_curve: list[dict]) -> dict:
    del equity_curve  # reserved for future extensions
    if not trades:
        return {
            "scatter": [],
            "streaks": {"max_win_streak": 0, "max_loss_streak": 0, "current_streak": 0, "current_streak_type": "none"},
            "summary": {
                "total_trades": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "win_rate": 0.0,
                "avg_win": 0.0,
                "avg_loss": 0.0,
                "profit_factor": 0.0,
                "expectancy": 0.0,
                "largest_win": 0.0,
                "largest_loss": 0.0,
                "avg_holding_days": 0.0,
            },
        }

    trade_df = pd.DataFrame(trades).copy()
    if trade_df.empty:
        return {
            "scatter": [],
            "streaks": {"max_win_streak": 0, "max_loss_streak": 0, "current_streak": 0, "current_streak_type": "none"},
            "summary": {
                "total_trades": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "win_rate": 0.0,
                "avg_win": 0.0,
                "avg_loss": 0.0,
                "profit_factor": 0.0,
                "expectancy": 0.0,
                "largest_win": 0.0,
                "largest_loss": 0.0,
                "avg_holding_days": 0.0,
            },
        }

    trade_df["action"] = trade_df.get("action", "").astype(str).str.upper()
    trade_df["date"] = pd.to_datetime(trade_df.get("date"), errors="coerce")
    trade_df["quantity"] = pd.to_numeric(trade_df.get("quantity"), errors="coerce").fillna(0.0)
    trade_df["price"] = pd.to_numeric(trade_df.get("price"), errors="coerce").fillna(0.0)
    trade_df = trade_df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
    if trade_df.empty:
        return {
            "scatter": [],
            "streaks": {"max_win_streak": 0, "max_loss_streak": 0, "current_streak": 0, "current_streak_type": "none"},
            "summary": {
                "total_trades": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "win_rate": 0.0,
                "avg_win": 0.0,
                "avg_loss": 0.0,
                "profit_factor": 0.0,
                "expectancy": 0.0,
                "largest_win": 0.0,
                "largest_loss": 0.0,
                "avg_holding_days": 0.0,
            },
        }

    pairs: list[dict[str, Any]] = []
    open_buy: dict[str, Any] | None = None
    for _, row in trade_df.iterrows():
        action = str(row["action"]).upper()
        if action == "BUY":
            open_buy = row.to_dict()
            continue
        if action != "SELL" or open_buy is None:
            continue
        entry_price = float(open_buy["price"])
        exit_price = float(row["price"])
        quantity = float(abs(open_buy["quantity"]) if open_buy["quantity"] else abs(row["quantity"]))
        if quantity <= 0:
            quantity = 1.0
        pnl = (exit_price - entry_price) * quantity
        ret_pct = ((exit_price / entry_price) - 1.0) * 100.0 if entry_price != 0 else 0.0
        holding_days = int(max(0, (row["date"] - open_buy["date"]).days))
        pairs.append(
            {
                "entry_date": open_buy["date"].date().isoformat(),
                "exit_date": row["date"].date().isoformat(),
                "entry_price": round(entry_price, 6),
                "exit_price": round(exit_price, 6),
                "pnl": round(float(pnl), 6),
                "return_pct": round(float(ret_pct), 6),
                "holding_days": holding_days,
                "quantity": round(float(quantity), 6),
            }
        )
        open_buy = None

    if not pairs:
        return {
            "scatter": [],
            "streaks": {"max_win_streak": 0, "max_loss_streak": 0, "current_streak": 0, "current_streak_type": "none"},
            "summary": {
                "total_trades": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "win_rate": 0.0,
                "avg_win": 0.0,
                "avg_loss": 0.0,
                "profit_factor": 0.0,
                "expectancy": 0.0,
                "largest_win": 0.0,
                "largest_loss": 0.0,
                "avg_holding_days": 0.0,
            },
        }

    pair_df = pd.DataFrame(pairs)
    pnl = pair_df["pnl"].astype(float)
    wins = pnl[pnl > 0]
    losses = pnl[pnl < 0]
    total_trades = int(len(pair_df))
    winning_trades = int((pnl > 0).sum())
    losing_trades = int((pnl < 0).sum())
    win_rate = (winning_trades / total_trades) * 100.0 if total_trades else 0.0
    avg_win = float(wins.mean()) if not wins.empty else 0.0
    avg_loss = float(losses.mean()) if not losses.empty else 0.0
    total_wins = float(wins.sum()) if not wins.empty else 0.0
    total_losses = float(abs(losses.sum())) if not losses.empty else 0.0
    profit_factor = float(total_wins / total_losses) if total_losses > 0 else 0.0
    expectancy = float(pnl.mean()) if total_trades else 0.0
    largest_win = float(pnl.max()) if total_trades else 0.0
    largest_loss = float(pnl.min()) if total_trades else 0.0
    avg_holding_days = float(pair_df["holding_days"].mean()) if total_trades else 0.0

    outcomes = [1 if x > 0 else -1 for x in pnl.tolist()]
    max_win_streak = 0
    max_loss_streak = 0
    cur_type = 0
    cur_count = 0
    for out in outcomes:
        if out == cur_type:
            cur_count += 1
        else:
            cur_type = out
            cur_count = 1
        if cur_type == 1:
            max_win_streak = max(max_win_streak, cur_count)
        else:
            max_loss_streak = max(max_loss_streak, cur_count)
    current_streak_type = "win" if cur_type == 1 else "loss"

    return {
        "scatter": pairs,
        "streaks": {
            "max_win_streak": int(max_win_streak),
            "max_loss_streak": int(max_loss_streak),
            "current_streak": int(cur_count),
            "current_streak_type": current_streak_type,
        },
        "summary": {
            "total_trades": total_trades,
            "winning_trades": winning_trades,
            "losing_trades": losing_trades,
            "win_rate": round(win_rate, 6),
            "avg_win": round(avg_win, 6),
            "avg_loss": round(avg_loss, 6),
            "profit_factor": round(profit_factor, 6),
            "expectancy": round(expectancy, 6),
            "largest_win": round(largest_win, 6),
            "largest_loss": round(largest_loss, 6),
            "avg_holding_days": round(avg_holding_days, 6),
        },
    }


def compute_full_analytics(
    equity_curve: list[dict],
    trades: list[dict],
    rolling_window: int = 60,
    histogram_bins: int = 50,
) -> dict[str, Any]:
    return {
        "monthly_returns": compute_monthly_returns(equity_curve),
        "drawdown_series": compute_drawdown_series(equity_curve),
        "rolling_metrics": compute_rolling_metrics(equity_curve, window=rolling_window),
        "return_distribution": compute_return_distribution(equity_curve, bins=histogram_bins),
        "trade_analytics": compute_trade_analytics(trades, equity_curve),
    }
