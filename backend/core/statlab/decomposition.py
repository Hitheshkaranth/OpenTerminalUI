import pandas as pd
import numpy as np
from statsmodels.tsa.seasonal import STL

def _safe_float(val):
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except:
        return 0.0

def decompose_series(prices, *, period: int = 21) -> dict:
    if len(prices) < 30:
        raise ValueError("Series too short (minimum 30 points required)")

    # Ensure DatetimeIndex
    if not isinstance(prices.index, pd.DatetimeIndex):
        prices.index = pd.to_datetime(prices.index)
    
    # Sort and handle duplicates
    prices = prices.sort_index()
    prices = prices[~prices.index.duplicated(keep='last')]

    # Clamp period
    clamped_period = max(2, min(period, len(prices) // 2))
    
    success = False
    try:
        # STL requires period >= 2
        res = STL(prices, period=clamped_period, robust=True).fit()
        observed = res.observed
        trend = res.trend
        seasonal = res.seasonal
        resid = res.resid
        success = True
    except:
        pass

    if not success:
        # Fallback to moving average
        observed = prices
        trend = prices.rolling(window=clamped_period, center=True).mean().fillna(method='bfill').fillna(method='ffill')
        resid = observed - trend
        seasonal = pd.Series(0.0, index=prices.index)

    # Last 300 pts
    subset_len = 300
    dates = prices.index[-subset_len:]
    observed_vals = observed.iloc[-subset_len:]
    trend_vals = trend.iloc[-subset_len:]
    seasonal_vals = seasonal.iloc[-subset_len:]
    resid_vals = resid.iloc[-subset_len:]

    series_json = [
        {
            "date": d.strftime("%Y-%m-%d"),
            "observed": _safe_float(observed_vals.iloc[i]),
            "trend": _safe_float(trend_vals.iloc[i]),
            "seasonal": _safe_float(seasonal_vals.iloc[i]),
            "resid": _safe_float(resid_vals.iloc[i])
        }
        for i, d in enumerate(dates)
    ]

    return {
        "period": clamped_period,
        "series": series_json
    }
