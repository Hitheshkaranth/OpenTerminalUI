from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from math import isnan, log
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from statsmodels.tsa.stattools import adfuller, coint

from backend.api.deps import get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart
from backend.auth.deps import get_current_user
from backend.models import User
from backend.shared.cache import cache as cache_instance

router = APIRouter(prefix="/api/pairs", tags=["pairs"])

logger = logging.getLogger(__name__)

_PERIOD_TO_RANGE: dict[str, str] = {
    "1M": "1mo",
    "3M": "3mo",
    "6M": "6mo",
    "1Y": "1y",
    "2Y": "2y",
    "3Y": "3y",
    "5Y": "5y",
}

class PairTestRequest(BaseModel):
    symbol1: str = Field(..., min_length=1)
    symbol2: str = Field(..., min_length=1)
    period: str = "2Y"

class PairSpreadRequest(BaseModel):
    symbol1: str = Field(..., min_length=1)
    symbol2: str = Field(..., min_length=1)
    period: str = "2Y"
    zwindow: int = Field(default=60, ge=10, le=252)
    entry_z: float = 2.0
    exit_z: float = 0.5

class PairScanRequest(BaseModel):
    symbols: list[str] = Field(..., min_length=2, max_length=15)
    period: str = "2Y"

def _to_iso_date(value: Any) -> str:
    if isinstance(value, pd.Timestamp):
        ts = value
    else:
        ts = pd.Timestamp(value)
    if ts.tzinfo is not None:
        ts = ts.tz_convert(timezone.utc).tz_localize(None)
    return ts.strftime("%Y-%m-%d")

def _period_to_range(period: str) -> str:
    try:
        return _PERIOD_TO_RANGE[period.upper()]
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"Unsupported period: {period}") from exc

def _normalize_symbols(symbols: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in symbols:
        symbol = raw.strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        normalized.append(symbol)
    return normalized

def _coerce(val: Any) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
        if isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except (ValueError, TypeError):
        return 0.0

async def _load_close_frame(symbols: list[str], period: str) -> pd.DataFrame:
    range_str = _period_to_range(period)
    fetcher = await get_unified_fetcher()
    series_map: dict[str, pd.Series] = {}
    for symbol in symbols:
        try:
            raw = await fetcher.fetch_history(symbol, range_str=range_str, interval="1d")
            frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
            if not frame.empty and "Close" in frame:
                series_map[symbol] = frame["Close"]
        except Exception as e:
            logger.warning(f"Failed to fetch {symbol}: {e}")
            continue
    
    if not series_map:
        return pd.DataFrame()
    
    df = pd.DataFrame(series_map).dropna()
    return df

def engle_granger(y: pd.Series, x: pd.Series) -> dict[str, Any]:
    # OLS: y = alpha + beta * x
    X = sm.add_constant(x)
    model = sm.OLS(y, X).fit()
    alpha = model.params.iloc[0]
    beta = model.params.iloc[1]
    
    resid = y - (alpha + beta * x)
    
    # ADF test on residuals
    adf_res = adfuller(resid)
    adf_stat = adf_res[0]
    adf_pvalue = adf_res[1]
    
    # Cointegration test
    _, coint_pvalue, _ = coint(y, x)
    
    # Half-life of mean reversion: regress d(resid) on lag(resid)
    resid_lag = resid.shift(1)
    resid_diff = resid.diff()
    df_hl = pd.DataFrame({"diff": resid_diff, "lag": resid_lag}).dropna()
    
    half_life = 0.0
    if len(df_hl) > 10:
        model_hl = sm.OLS(df_hl["diff"], df_hl["lag"]).fit()
        lambda_val = model_hl.params.iloc[0]
        if lambda_val < 0:
            half_life = -log(2) / lambda_val
        else:
            half_life = 9999.0
            
    resid_mean = resid.mean()
    resid_std = resid.std()
    zscore_current = (resid.iloc[-1] - resid_mean) / resid_std if resid_std > 0 else 0.0
    
    return {
        "alpha": alpha,
        "beta": beta,
        "adf_stat": adf_stat,
        "adf_pvalue": adf_pvalue,
        "coint_pvalue": coint_pvalue,
        "half_life": half_life,
        "zscore_current": zscore_current,
        "resid_mean": resid_mean,
        "resid_std": resid_std,
        "cointegrated": bool(coint_pvalue < 0.05)
    }

@router.post("/test")
async def pair_test(
    payload: PairTestRequest,
    _: User = Depends(get_current_user)
) -> dict[str, Any]:
    symbols = _normalize_symbols([payload.symbol1, payload.symbol2])
    if len(symbols) != 2:
        raise HTTPException(status_code=400, detail="Two distinct symbols required")
    
    try:
        df = await _load_close_frame(symbols, payload.period)
        if df.empty or len(df) < 20:
            raise HTTPException(status_code=404, detail="Insufficient overlapping data for pair test")
        
        stats = engle_granger(df[symbols[0]], df[symbols[1]])
        verdict = f"Cointegrated (p={stats['coint_pvalue']:.4f})" if stats["cointegrated"] else f"Not cointegrated (p={stats['coint_pvalue']:.4f})"
        
        return {
            "symbol1": symbols[0],
            "symbol2": symbols[1],
            "period": payload.period,
            "period_start": _to_iso_date(df.index.min()),
            "period_end": _to_iso_date(df.index.max()),
            **{k: _coerce(v) for k, v in stats.items() if k != "cointegrated"},
            "cointegrated": stats["cointegrated"],
            "verdict": verdict
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Pair test failed")
        raise HTTPException(status_code=502, detail=str(e))

@router.post("/spread")
async def pair_spread(
    payload: PairSpreadRequest,
    _: User = Depends(get_current_user)
) -> dict[str, Any]:
    symbols = _normalize_symbols([payload.symbol1, payload.symbol2])
    if len(symbols) != 2:
        raise HTTPException(status_code=400, detail="Two distinct symbols required")
    
    try:
        df = await _load_close_frame(symbols, payload.period)
        if df.empty or len(df) < payload.zwindow:
            raise HTTPException(status_code=404, detail="Insufficient data for spread calculation")
        
        y, x = df[symbols[0]], df[symbols[1]]
        stats = engle_granger(y, x)
        beta, alpha = stats["beta"], stats["alpha"]
        
        spread = y - (alpha + beta * x)
        rolling_mean = spread.rolling(window=payload.zwindow, min_periods=payload.zwindow // 2).mean()
        rolling_std = spread.rolling(window=payload.zwindow, min_periods=payload.zwindow // 2).std()
        zscore = (spread - rolling_mean) / rolling_std
        
        points = []
        for idx, row in df.iterrows():
            points.append({
                "date": _to_iso_date(idx),
                "price1": _coerce(row[symbols[0]]),
                "price2": _coerce(row[symbols[1]]),
                "hedged": _coerce(beta * row[symbols[1]]),
                "spread": _coerce(spread.loc[idx]),
                "zscore": _coerce(zscore.loc[idx])
            })
            
        return {
            "symbol1": symbols[0],
            "symbol2": symbols[1],
            "beta": _coerce(beta),
            "points": points,
            "entry_z": payload.entry_z,
            "exit_z": payload.exit_z
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Spread calculation failed")
        raise HTTPException(status_code=502, detail=str(e))

@router.post("/signals")
async def pair_signals(
    payload: PairSpreadRequest,
    _: User = Depends(get_current_user)
) -> dict[str, Any]:
    symbols = _normalize_symbols([payload.symbol1, payload.symbol2])
    if len(symbols) != 2:
        raise HTTPException(status_code=400, detail="Two distinct symbols required")
    
    try:
        df = await _load_close_frame(symbols, payload.period)
        if df.empty or len(df) < payload.zwindow:
            raise HTTPException(status_code=404, detail="Insufficient data for signal calculation")
        
        y, x = df[symbols[0]], df[symbols[1]]
        stats = engle_granger(y, x)
        beta, alpha = stats["beta"], stats["alpha"]
        
        spread = y - (alpha + beta * x)
        rolling_mean = spread.rolling(window=payload.zwindow, min_periods=payload.zwindow // 2).mean()
        rolling_std = spread.rolling(window=payload.zwindow, min_periods=payload.zwindow // 2).std()
        zscore = (spread - rolling_mean) / rolling_std
        
        position = 0
        positions = []
        daily_returns = []
        
        for i in range(len(df)):
            z = zscore.iloc[i]
            if isnan(z):
                positions.append(0)
                daily_returns.append(0.0)
                continue
            
            # Position transition
            if position == 0:
                if z > payload.entry_z:
                    position = -1
                elif z < -payload.entry_z:
                    position = 1
            else:
                if abs(z) < payload.exit_z or (position == 1 and z > 0) or (position == -1 and z < 0):
                    position = 0
            
            positions.append(position)
            
            if i > 0:
                pos_prev = positions[i-1]
                diff = spread.iloc[i] - spread.iloc[i-1]
                denom = abs(df.iloc[i][symbols[0]]) + abs(beta * df.iloc[i][symbols[1]])
                ret = (pos_prev * diff / denom) if denom > 0 else 0.0
                daily_returns.append(ret)
            else:
                daily_returns.append(0.0)
                
        returns_ser = pd.Series(daily_returns)
        equity = (1 + returns_ser).cumprod()
        
        trades, wins, cur_pnl = 0, 0, 1.0
        for i in range(1, len(positions)):
            if positions[i] != 0 and positions[i-1] == 0:
                cur_pnl = 1.0
            if positions[i] != 0:
                cur_pnl *= (1 + daily_returns[i])
            if positions[i] == 0 and positions[i-1] != 0:
                trades += 1
                if cur_pnl > 1.0: wins += 1
                
        std = returns_ser.std()
        sharpe = (returns_ser.mean() / std * (252**0.5)) if std > 0 else 0.0
        max_dd = ((equity - equity.cummax()) / equity.cummax()).min()
        
        equity_points = []
        for i in range(len(df)):
            equity_points.append({
                "date": _to_iso_date(df.index[i]),
                "equity": _coerce(equity.iloc[i]),
                "position": positions[i],
                "zscore": _coerce(zscore.iloc[i])
            })
            
        return {
            "symbol1": symbols[0],
            "symbol2": symbols[1],
            "beta": _coerce(beta),
            "entry_z": payload.entry_z,
            "exit_z": payload.exit_z,
            "equity": equity_points,
            "stats": {
                "trades": trades,
                "win_rate": _coerce(wins / trades if trades > 0 else 0.0),
                "sharpe": _coerce(sharpe),
                "max_drawdown": _coerce(max_dd),
                "total_return": _coerce(equity.iloc[-1] - 1.0)
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Signal calculation failed")
        raise HTTPException(status_code=502, detail=str(e))

@router.post("/scan")
async def pair_scan(
    payload: PairScanRequest,
    _: User = Depends(get_current_user)
) -> dict[str, Any]:
    symbols = _normalize_symbols(payload.symbols)
    if len(symbols) < 2:
        raise HTTPException(status_code=400, detail="At least two symbols required")
    
    cache_key = cache_instance.build_key("pair_scan", "_".join(sorted(symbols)), {"period": payload.period})
    cached = await cache_instance.get(cache_key)
    if isinstance(cached, dict):
        return cached
        
    try:
        df = await _load_close_frame(symbols, payload.period)
        if df.empty or len(df) < 20:
            raise HTTPException(status_code=404, detail="Insufficient data for pair scan")
        
        avail = [s for s in symbols if s in df.columns]
        results = []
        for s1, s2 in combinations(avail, 2):
            try:
                st = engle_granger(df[s1], df[s2])
                results.append({
                    "symbol1": s1,
                    "symbol2": s2,
                    "beta": _coerce(st["beta"]),
                    "coint_pvalue": _coerce(st["coint_pvalue"]),
                    "adf_pvalue": _coerce(st["adf_pvalue"]),
                    "half_life": _coerce(st["half_life"]),
                    "zscore_current": _coerce(st["zscore_current"]),
                    "cointegrated": st["cointegrated"]
                })
            except Exception:
                continue
                
        results.sort(key=lambda x: x["coint_pvalue"] or 1.0)
        data = {"period": payload.period, "results": results[:50]}
        await cache_instance.set(cache_key, data, ttl=1800)
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Pair scan failed")
        raise HTTPException(status_code=502, detail=str(e))
