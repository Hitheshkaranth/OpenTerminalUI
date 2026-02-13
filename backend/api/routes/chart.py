from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import cache_instance, get_unified_fetcher
from backend.core.models import ChartResponse, IndicatorPoint, IndicatorResponse, OhlcvPoint
from backend.core.technicals import compute_indicator

router = APIRouter()

def _synthetic_history(ticker: str, interval: str, range_val: str) -> pd.DataFrame:
    # Deterministic synthetic series for UI continuity when upstream market data is unavailable.
    seed = abs(hash(f"{ticker}:{interval}:{range_val}")) % (2**32)
    rng = random.Random(seed)
    interval_map = {
        "1m": ("minutes", 1, 360),
        "5m": ("minutes", 5, 360),
        "15m": ("minutes", 15, 360),
        "30m": ("minutes", 30, 360),
        "1h": ("hours", 1, 360),
        "4h": ("hours", 4, 360),
        "1d": ("days", 1, 365),
        "1wk": ("days", 7, 260),
        "1mo": ("days", 30, 120),
    }
    unit, step, points = interval_map.get(interval, ("days", 1, 365))
    now = datetime.now(timezone.utc)
    dt_list: list[datetime] = []
    price = 1000.0 + rng.uniform(-150, 150)
    rows: list[dict[str, float]] = []
    for i in range(points):
        dt = now - timedelta(**{unit: step * (points - i)})
        drift = 0.3 * math.sin(i / 18.0) + rng.uniform(-1.8, 1.8)
        open_p = price
        close_p = max(50.0, open_p + drift)
        high_p = max(open_p, close_p) + abs(rng.uniform(0.4, 3.6))
        low_p = min(open_p, close_p) - abs(rng.uniform(0.4, 3.6))
        volume = max(1000.0, 1_000_000 + rng.uniform(-250_000, 250_000))
        rows.append({"Open": open_p, "High": high_p, "Low": low_p, "Close": close_p, "Volume": volume})
        dt_list.append(dt)
        price = close_p
    df = pd.DataFrame(rows, index=pd.DatetimeIndex(dt_list))
    return df

def _parse_yahoo_chart(data: Dict[str, Any]) -> pd.DataFrame:
    # Parses the raw Yahoo Chart API response into a DataFrame
    # Expected structure: {"chart": {"result": [{"timestamp": [...], "indicators": {"quote": [...]}}]}}
    try:
        chart_result = (data.get("chart") or {}).get("result")
        if not chart_result or not isinstance(chart_result, list):
            return pd.DataFrame()
            
        res = chart_result[0]
        timestamps = res.get("timestamp")
        if not timestamps:
            return pd.DataFrame()
            
        quote = (res.get("indicators") or {}).get("quote")
        if not quote or not isinstance(quote, list):
            return pd.DataFrame()
            
        q = quote[0]
        
        # Zip and create dict
        # Filter out None values in OHLC
        opens = q.get("open") or []
        highs = q.get("high") or []
        lows = q.get("low") or []
        closes = q.get("close") or []
        volumes = q.get("volume") or []
        
        # Validation
        length = len(timestamps)
        if not (len(opens) == length and len(highs) == length and len(lows) == length and len(closes) == length):
            # Try to slice to min length? Or just fail?
            # Usually strict alignment is required
            return pd.DataFrame()

        rows = []
        utc_dates = []
        for i in range(length):
            ts = timestamps[i]
            o, h, l, c, v = opens[i], highs[i], lows[i], closes[i], volumes[i]
            
            if None in (o, h, l, c): 
                continue
                
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            rows.append({
                "Open": float(o),
                "High": float(h),
                "Low": float(l),
                "Close": float(c),
                "Volume": float(v) if v is not None else 0.0
            })
            utc_dates.append(dt)
            
        if not rows:
            return pd.DataFrame()
            
        df = pd.DataFrame(rows, index=pd.DatetimeIndex(utc_dates))
        return df

    except Exception:
        return pd.DataFrame()


@router.get("/chart/{ticker}", response_model=ChartResponse)
async def get_chart(ticker: str, interval: str = Query(default="1d"), range: str = Query(default="1y")) -> ChartResponse:
    key = cache_instance.build_key("chart", ticker.upper(), {"i": interval, "r": range})
    cached = await cache_instance.get(key)
    if cached:
        return ChartResponse(**cached)

    fetcher = await get_unified_fetcher()
    # UnifiedFetcher.fetch_history prioritizes NSE > Yahoo > FMP
    # But currently returns raw dict. We need to parse it.
    # If it's Yahoo-like data:
    raw_data = await fetcher.fetch_history(ticker, range_str=range, interval=interval)
    
    hist = pd.DataFrame()
    if raw_data and "chart" in raw_data:
        hist = _parse_yahoo_chart(raw_data)
    elif raw_data and "historical" in raw_data: # FMP style
        # TODO: Parse FMP if needed, but Yahoo is primary
        pass
        
    warnings: list[Dict[str, str]] = []
    if hist.empty:
        hist = _synthetic_history(ticker=ticker, interval=interval, range_val=range)
        warnings.append(
            {
                "code": "chart_data_fallback",
                "message": "Live data unavailable; displaying synthetic fallback series.",
            }
        )
    if hist.empty:
        raise HTTPException(status_code=404, detail="No chart data available")

    data: list[OhlcvPoint] = []
    for idx, row in hist.iterrows():
        # idx is Timestamp
        ts_int = int(idx.timestamp())
        data.append(OhlcvPoint(
            t=ts_int, 
            o=float(row["Open"]), 
            h=float(row["High"]), 
            l=float(row["Low"]), 
            c=float(row["Close"]), 
            v=float(row.get("Volume", 0) or 0)
        ))

    payload = {
        "ticker": ticker.upper(),
        "interval": interval,
        "currency": "INR",
        "data": [d.model_dump() for d in data],
        "meta": {"warnings": warnings},
    }
    await cache_instance.set(key, payload, ttl=300)
    return ChartResponse(**payload)


@router.get("/chart/{ticker}/indicators", response_model=IndicatorResponse)
async def get_indicator(
    ticker: str,
    type: str,
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
    period: int | None = None,
    std_dev: float | None = None,
    fast: int | None = None,
    slow: int | None = None,
    signal: int | None = None,
) -> IndicatorResponse:
    # We don't cache indicators directly logic-heavy, but underlying data is cached by get_chart logic if we reused it
    # But here we fetching history again.
    
    fetcher = await get_unified_fetcher()
    raw_data = await fetcher.fetch_history(ticker, range_str=range, interval=interval)
    
    hist = pd.DataFrame()
    if raw_data and "chart" in raw_data:
        hist = _parse_yahoo_chart(raw_data)
        
    warnings: list[Dict[str, str]] = []
    if hist.empty:
        hist = _synthetic_history(ticker=ticker, interval=interval, range_val=range)
        warnings.append({
            "code": "indicator_data_fallback",
            "message": "Live data unavailable; indicator computed on synthetic fallback series.",
        })
        
    if hist.empty:
        raise HTTPException(status_code=404, detail="No chart data available")

    params: dict[str, int | float] = {}
    for key, val in {"period": period, "std_dev": std_dev, "fast": fast, "slow": slow, "signal": signal}.items():
        if val is not None:
            params[key] = val

    try:
        # compute_indicator is synchronous (pandas operations). 
        # Ideally run in threadpool if heavy, but for simple indicators it's fast enough.
        indicator = compute_indicator(hist, type, params)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    points: list[IndicatorPoint] = []
    for idx, row in indicator.iterrows():
        # idx is Timestamp
        ts_int = int(idx.timestamp())
        values = {col: (float(v) if v == v else None) for col, v in row.items()}
        points.append(IndicatorPoint(t=ts_int, values=values))

    return IndicatorResponse(ticker=ticker.upper(), indicator=type, params=params, data=points, meta={"warnings": warnings})
