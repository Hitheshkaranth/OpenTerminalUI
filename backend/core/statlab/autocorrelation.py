import pandas as pd
import numpy as np
import warnings
from statsmodels.tsa.stattools import acf, pacf
from statsmodels.stats.diagnostic import acorr_ljungbox

warnings.filterwarnings("ignore")

def _safe_float(val):
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except Exception:
        return 0.0

def autocorrelation_analysis(prices: pd.Series, *, nlags: int = 30, use_returns: bool = True) -> dict:
    if len(prices) < 40:
        raise ValueError("Series too short (minimum 40 points required)")
    
    if use_returns:
        series = prices.pct_change().dropna()
    else:
        series = prices.dropna()
        
    n = len(series)
    if n < 30:
        raise ValueError("Series too short after preprocessing (minimum 30 points required)")

    max_lags = max(5, min(nlags, n // 2 - 1))
    
    try:
        acf_values = acf(series, nlags=max_lags, fft=True)
        pacf_values = pacf(series, nlags=max_lags)
        
        conf_band = 1.96 / np.sqrt(n)
        
        acf_list = [
            {
                "lag": int(i),
                "value": _safe_float(v),
                "significant": bool(abs(v) > conf_band and i > 0)
            }
            for i, v in enumerate(acf_values)
        ]
        
        pacf_list = [
            {
                "lag": int(i),
                "value": _safe_float(v),
                "significant": bool(abs(v) > conf_band and i > 0)
            }
            for i, v in enumerate(pacf_values)
        ]
        
        # Ljung-Box
        lb_lags = [5, 10, 20]
        lb_lags = [l for l in lb_lags if l <= max_lags]
        if not lb_lags:
            lb_lags = [max_lags]
            
        lb = acorr_ljungbox(series, lags=lb_lags, return_df=True)
        ljung_box_list = []
        for lag in lb_lags:
            stat = lb.loc[lag, "lb_stat"]
            pvalue = lb.loc[lag, "lb_pvalue"]
            ljung_box_list.append({
                "lag": int(lag),
                "stat": _safe_float(stat),
                "pvalue": _safe_float(pvalue),
                "has_autocorr": bool(pvalue < 0.05)
            })
            
        any_sig_acf = any(item["significant"] for item in acf_list[1:6])
        interpretation = "Significant short-term autocorrelation detected." if any_sig_acf else "No significant short-term autocorrelation detected."
        
        return {
            "use_returns": use_returns,
            "n_obs": int(n),
            "conf_band": _safe_float(conf_band),
            "acf": acf_list,
            "pacf": pacf_list,
            "ljung_box": ljung_box_list,
            "interpretation": interpretation
        }
    except Exception as e:
        return {
            "use_returns": use_returns,
            "n_obs": int(n),
            "conf_band": 0.0,
            "acf": [],
            "pacf": [],
            "ljung_box": [],
            "interpretation": f"Autocorrelation analysis failed: {str(e)}"
        }
