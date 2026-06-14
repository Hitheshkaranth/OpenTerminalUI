import pandas as pd
import numpy as np
import warnings
from statsmodels.tsa.stattools import adfuller, kpss

# Suppress InterpolationWarning from KPSS
warnings.filterwarnings("ignore")

def _safe_float(val):
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except:
        return 0.0

def _hurst_exponent(series):
    """Calculates Hurst exponent using a simple lagged variance method."""
    try:
        lags = range(2, 20)
        tau = [np.std(np.subtract(series[lag:], series[:-lag])) for lag in lags]
        reg = np.polyfit(np.log(lags), np.log(tau), 1)
        return reg[0]
    except:
        return 0.5

def stationarity_tests(prices) -> dict:
    if len(prices) < 30:
        raise ValueError("Series too short (minimum 30 points required)")

    # ADF
    try:
        adf_res = adfuller(prices)
        adf_dict = {
            "stat": _safe_float(adf_res[0]),
            "pvalue": _safe_float(adf_res[1]),
            "is_stationary": bool(adf_res[1] < 0.05)
        }
    except:
        adf_dict = {"stat": 0.0, "pvalue": 1.0, "is_stationary": False}

    # KPSS
    try:
        kpss_res = kpss(prices, regression='c', nlags="auto")
        kpss_dict = {
            "stat": _safe_float(kpss_res[0]),
            "pvalue": _safe_float(kpss_res[1]),
            "is_stationary": bool(kpss_res[1] > 0.05)
        }
    except:
        kpss_dict = {"stat": 0.0, "pvalue": 0.0, "is_stationary": False}

    # Returns ADF
    returns = prices.pct_change().dropna()
    try:
        if len(returns) >= 30:
            ret_adf_res = adfuller(returns)
            ret_adf_dict = {
                "stat": _safe_float(ret_adf_res[0]),
                "pvalue": _safe_float(ret_adf_res[1]),
                "is_stationary": bool(ret_adf_res[1] < 0.05)
            }
        else:
            ret_adf_dict = {"stat": 0.0, "pvalue": 1.0, "is_stationary": False}
    except:
        ret_adf_dict = {"stat": 0.0, "pvalue": 1.0, "is_stationary": False}

    # Hurst
    hurst = _safe_float(_hurst_exponent(prices.values))

    # Interpretation
    price_stat = "stationary" if adf_dict["is_stationary"] else "non-stationary"
    ret_stat = "stationary" if ret_adf_dict["is_stationary"] else "non-stationary"
    
    hurst_desc = "random walk"
    if hurst < 0.45:
        hurst_desc = "mean-reverting"
    elif hurst > 0.55:
        hurst_desc = "trending"
        
    interpretation = f"Prices {price_stat}; returns {ret_stat}; Hurst {hurst} suggests {hurst_desc}."

    return {
        "adf": adf_dict,
        "kpss": kpss_dict,
        "returns_adf": ret_adf_dict,
        "hurst": hurst,
        "interpretation": interpretation
    }
