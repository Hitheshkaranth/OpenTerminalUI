from __future__ import annotations
from itertools import product
from typing import Any
import numpy as np
import pandas as pd

def _safe_float(val) -> float:
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except Exception:
        return 0.0

def _closes(prices: list[dict]) -> pd.Series:
    if not prices:
        return pd.Series(dtype=float)
    df = pd.DataFrame(prices)
    col = "close" if "close" in df.columns else ("equity" if "equity" in df.columns else None)
    if col is None:
        return pd.Series(dtype=float)
    s = pd.to_numeric(df[col], errors="coerce").dropna().reset_index(drop=True)
    return s

def _metrics_from_strategy_returns(strat_ret: pd.Series, periods_per_year: int = 252) -> dict:
    if strat_ret.empty:
        return {
            "total_return": 0.0, "volatility": 0.0, "sharpe": 0.0,
            "max_drawdown": 0.0, "cagr": 0.0, "win_rate": 0.0, "calmar": 0.0
        }
    
    # Equity curve: (1 + r).cumprod()
    # We assume strat_ret are simple returns (pct_change)
    equity = (1 + strat_ret).cumprod()
    total_return = equity.iloc[-1] - 1 if not equity.empty else 0.0
    
    std = strat_ret.std(ddof=1)
    volatility = std * np.sqrt(periods_per_year)
    sharpe = (strat_ret.mean() / std * np.sqrt(periods_per_year)) if std != 0 else 0.0
    
    max_drawdown = (equity / equity.cummax() - 1).min() if not equity.empty else 0.0
    
    n_bars = len(strat_ret)
    last_equity = equity.iloc[-1] if n_bars > 0 else 0.0
    if n_bars > 0 and last_equity > 0:
        cagr = last_equity**(periods_per_year / n_bars) - 1
    else:
        cagr = 0.0
        
    win_rate = (strat_ret > 0).mean() * 100
    calmar = (cagr / abs(max_drawdown)) if max_drawdown != 0 else 0.0
    
    return {
        "total_return": _safe_float(total_return),
        "volatility": _safe_float(volatility),
        "sharpe": _safe_float(sharpe),
        "max_drawdown": _safe_float(max_drawdown),
        "cagr": _safe_float(cagr),
        "win_rate": _safe_float(win_rate),
        "calmar": _safe_float(calmar)
    }

def _compute_rsi(series: pd.Series, period: int) -> pd.Series:
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).fillna(0)
    loss = (-delta.where(delta < 0, 0)).fillna(0)
    
    # Wilder's smoothing (RSI) uses alpha = 1/period
    avg_gain = gain.ewm(alpha=1/period, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period).mean()
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def vectorized_sweep(
    prices: list[dict], 
    strategy: str, 
    param_grid: dict[str, list], 
    *, 
    sort_by: str = "sharpe", 
    top_n: int = 100, 
    periods_per_year: int = 252
) -> dict:
    close = _closes(prices)
    if len(close) < 30:
        return {
            "strategy": strategy,
            "results": [],
            "heatmap": None,
            "best": None,
            "n_combos": 0,
            "warning": "insufficient data"
        }
    
    param_keys = sorted(param_grid.keys())
    # Ensure all values are lists
    grid_values = [param_grid[k] if isinstance(param_grid[k], list) else [param_grid[k]] for k in param_keys]
    param_combos = list(product(*grid_values))
    
    warning = None
    if len(param_combos) > 2000:
        param_combos = param_combos[:2000]
        warning = "truncated to 2000 combos"
    
    results = []
    pct_change = close.pct_change().fillna(0.0)
    
    for combo in param_combos:
        params = dict(zip(param_keys, combo))
        position = None
        
        if strategy == "sma_crossover":
            fast, slow = params.get("fast"), params.get("slow")
            if fast is None or slow is None or fast <= 0 or slow <= fast:
                continue
            pos = (close.rolling(fast).mean() > close.rolling(slow).mean())
            position = pos.astype(float).shift(1).fillna(0.0)
            
        elif strategy == "ema_crossover":
            fast, slow = params.get("fast"), params.get("slow")
            if fast is None or slow is None or fast <= 0 or slow <= fast:
                continue
            pos = (close.ewm(span=fast).mean() > close.ewm(span=slow).mean())
            position = pos.astype(float).shift(1).fillna(0.0)
            
        elif strategy == "rsi_threshold":
            period = params.get("period")
            oversold = params.get("oversold")
            overbought = params.get("overbought")
            if period is None or period <= 0 or oversold is None or overbought is None:
                continue
            rsi = _compute_rsi(close, period)
            raw = np.where(rsi < oversold, 1.0, np.where(rsi > overbought, 0.0, np.nan))
            pos = pd.Series(raw).ffill().fillna(0.0)
            position = pos.astype(float).shift(1).fillna(0.0)
            
        if position is not None:
            strat_ret = position * pct_change
            metrics = _metrics_from_strategy_returns(strat_ret, periods_per_year)
            results.append({"params": params, **metrics})
            
    # Sort results desc
    results.sort(key=lambda x: x.get(sort_by, 0.0), reverse=True)
    
    best = results[0] if results else None
    
    # Heatmap logic
    heatmap = None
    if len(param_keys) == 2:
        k1, k2 = param_keys
        v1s = sorted(list(set(grid_values[0])))
        v2s = sorted(list(set(grid_values[1])))
        
        if len(v1s) > 1 and len(v2s) > 1:
            # Map params to metric
            lookup = {}
            for r in results:
                # use tuple of sorted values as key
                lookup[(r["params"][k1], r["params"][k2])] = r.get(sort_by, 0.0)
            
            z = []
            for v2 in v2s: # y_values
                row = []
                for v1 in v1s: # x_values
                    row.append(_safe_float(lookup.get((v1, v2), 0.0)))
                z.append(row)
                
            heatmap = {
                "x_param": k1,
                "y_param": k2,
                "x_values": v1s,
                "y_values": v2s,
                "z": z,
                "metric": sort_by
            }
            
    return {
        "strategy": strategy,
        "sort_by": sort_by,
        "n_combos": len(results),
        "results": results[:top_n],
        "best": best,
        "heatmap": heatmap,
        "warning": warning
    }
