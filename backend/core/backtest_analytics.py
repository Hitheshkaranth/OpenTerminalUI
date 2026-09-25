from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from backend.core.backtest_metrics import compute_performance_metrics, compute_scenario_projections


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


_EMPTY_TRADE_SUMMARY: dict[str, Any] = {
    "total_trades": 0,
    "winning_trades": 0,
    "losing_trades": 0,
    "breakeven_trades": 0,
    "fill_count": 0,
    "win_rate": 0.0,
    "avg_win": 0.0,
    "avg_loss": 0.0,
    "profit_factor": 0.0,
    "expectancy": 0.0,
    "largest_win": 0.0,
    "largest_loss": 0.0,
    "avg_holding_days": 0.0,
}

_FLAT_EPS = 1e-9


def pair_round_trips(fills: list[Any]) -> list[dict[str, Any]]:
    """Group fills into round trips (flat -> position -> flat) with average-cost accounting.

    Scale-ins average into the entry price; partial exits realise PnL against the
    average cost; a fill that crosses through zero closes the round trip and opens
    a new one in the opposite direction with the remainder. Shorts are symmetric.
    Fills may be dicts or objects with ``date``/``action``/``quantity``/``price``.
    An open position at the end is not a completed round trip and is skipped.
    """

    def _get(fill: Any, key: str) -> Any:
        return fill.get(key) if isinstance(fill, dict) else getattr(fill, key, None)

    rows: list[tuple[pd.Timestamp, int, float, float]] = []
    for fill in fills:
        action = str(_get(fill, "action") or "").upper()
        if action not in {"BUY", "SELL"}:
            continue
        date = pd.to_datetime(_get(fill, "date"), errors="coerce")
        try:
            qty = abs(float(_get(fill, "quantity") or 0.0))
            price = float(_get(fill, "price") or 0.0)
        except (TypeError, ValueError):
            continue
        if pd.isna(date) or qty <= 0 or not np.isfinite(price):
            continue
        rows.append((date, 1 if action == "BUY" else -1, qty, price))
    rows.sort(key=lambda r: r[0])  # stable: same-timestamp fills keep input order

    trips: list[dict[str, Any]] = []
    pos = 0.0
    avg_cost = 0.0
    trip: dict[str, Any] | None = None

    def _open(date: pd.Timestamp, side: int) -> dict[str, Any]:
        return {"entry_date": date, "side": side, "pnl": 0.0, "entry_qty": 0.0, "entry_notional": 0.0, "exit_qty": 0.0, "exit_notional": 0.0}

    for date, side, qty, price in rows:
        remaining = qty
        while remaining > _FLAT_EPS:
            if abs(pos) <= _FLAT_EPS or np.sign(pos) == side:
                if trip is None:
                    trip = _open(date, side)
                    pos, avg_cost = 0.0, 0.0
                avg_cost = (avg_cost * abs(pos) + price * remaining) / (abs(pos) + remaining)
                pos += side * remaining
                trip["entry_qty"] += remaining
                trip["entry_notional"] += price * remaining
                remaining = 0.0
                continue
            close_qty = min(remaining, abs(pos))
            assert trip is not None
            trip["pnl"] += (price - avg_cost) * close_qty * np.sign(pos)
            trip["exit_qty"] += close_qty
            trip["exit_notional"] += price * close_qty
            pos += side * close_qty
            remaining -= close_qty
            if abs(pos) <= _FLAT_EPS:
                entry_price = trip["entry_notional"] / trip["entry_qty"]
                exit_price = trip["exit_notional"] / trip["exit_qty"]
                cost_basis = trip["entry_notional"] * (trip["exit_qty"] / trip["entry_qty"])
                trips.append(
                    {
                        "entry_date": trip["entry_date"].date().isoformat(),
                        "exit_date": date.date().isoformat(),
                        "entry_ts": trip["entry_date"].isoformat(),
                        "exit_ts": date.isoformat(),
                        "side": "long" if trip["side"] > 0 else "short",
                        "entry_price": round(float(entry_price), 6),
                        "exit_price": round(float(exit_price), 6),
                        "pnl": round(float(trip["pnl"]), 6),
                        "return_pct": round(float(trip["pnl"] / cost_basis * 100.0) if cost_basis else 0.0, 6),
                        "holding_days": int(max(0, (date - trip["entry_date"]).days)),
                        "quantity": round(float(trip["entry_qty"]), 6),
                    }
                )
                trip = None
                pos, avg_cost = 0.0, 0.0
    return trips


def summarize_round_trips(pnls: list[float]) -> dict[str, float]:
    pnl = pd.Series(pnls, dtype=float)
    wins = pnl[pnl > 0]
    losses = pnl[pnl < 0]
    decisive = int(len(wins) + len(losses))
    total_wins = float(wins.sum()) if not wins.empty else 0.0
    total_losses = float(abs(losses.sum())) if not losses.empty else 0.0
    return {
        "winning_trades": int(len(wins)),
        "losing_trades": int(len(losses)),
        "breakeven_trades": int(len(pnl) - decisive),
        # Breakeven round trips are neither wins nor losses.
        "win_rate": (len(wins) / decisive) * 100.0 if decisive else 0.0,
        "avg_win": float(wins.mean()) if not wins.empty else 0.0,
        "avg_loss": float(losses.mean()) if not losses.empty else 0.0,
        "profit_factor": float(total_wins / total_losses) if total_losses > 0 else 0.0,
    }


def compute_trade_analytics(trades: list[dict], equity_curve: list[dict]) -> dict:
    del equity_curve  # reserved for future extensions
    empty = {
        "scatter": [],
        "streaks": {"max_win_streak": 0, "max_loss_streak": 0, "current_streak": 0, "current_streak_type": "none"},
        "summary": {**_EMPTY_TRADE_SUMMARY, "fill_count": len(trades or [])},
    }
    pairs = pair_round_trips(trades or [])
    if not pairs:
        return empty

    pnl_list = [float(p["pnl"]) for p in pairs]
    stats = summarize_round_trips(pnl_list)
    total_trades = len(pairs)
    expectancy = float(np.mean(pnl_list))
    largest_win = float(max(pnl_list))
    largest_loss = float(min(pnl_list))
    avg_holding_days = float(np.mean([p["holding_days"] for p in pairs]))

    max_win_streak = 0
    max_loss_streak = 0
    cur_type = 0
    cur_count = 0
    for value in pnl_list:
        out = 1 if value > 0 else (-1 if value < 0 else 0)
        if out == 0:
            # breakeven ends a streak without starting a new one
            cur_type, cur_count = 0, 0
            continue
        if out == cur_type:
            cur_count += 1
        else:
            cur_type = out
            cur_count = 1
        if cur_type == 1:
            max_win_streak = max(max_win_streak, cur_count)
        else:
            max_loss_streak = max(max_loss_streak, cur_count)
    current_streak_type = "win" if cur_type == 1 else ("loss" if cur_type == -1 else "none")

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
            "winning_trades": stats["winning_trades"],
            "losing_trades": stats["losing_trades"],
            "breakeven_trades": stats["breakeven_trades"],
            "fill_count": len(trades),
            "win_rate": round(stats["win_rate"], 6),
            "avg_win": round(stats["avg_win"], 6),
            "avg_loss": round(stats["avg_loss"], 6),
            "profit_factor": round(stats["profit_factor"], 6),
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
        "performance_metrics": compute_performance_metrics(equity_curve),
        "scenario_projections": compute_scenario_projections(equity_curve),
    }
