import io
import contextlib
import pandas as pd
import numpy as np
import warnings
from statsmodels.tsa.stattools import grangercausalitytests

warnings.filterwarnings("ignore")

def _safe_float(val):
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except Exception:
        return 0.0

def _granger_min_p(data, max_lag):
    try:
        # data columns are [target, source]. grangercausalitytests prints its
        # result tables to stdout by default on statsmodels 0.14.x; redirect to
        # keep server logs clean (robust to the `verbose` arg being removed).
        with contextlib.redirect_stdout(io.StringIO()):
            res = grangercausalitytests(data, maxlag=max_lag)
        curve = []
        min_p = 1.0
        best_lag = 1
        for lag in range(1, max_lag + 1):
            pvalue = res[lag][0]["ssr_ftest"][1]
            curve.append({"lag": int(lag), "pvalue": _safe_float(pvalue)})
            if pvalue < min_p:
                min_p = pvalue
                best_lag = lag
        return best_lag, min_p, curve
    except Exception:
        return 1, 1.0, []

def granger_causality(a: pd.Series, b: pd.Series, *, max_lag: int = 5, use_returns: bool = True) -> dict:
    df = pd.concat([a, b], axis=1, sort=False).dropna()
    if len(df) < 60:
        raise ValueError("Series too short after alignment (minimum 60 points required)")
    
    if use_returns:
        df = df.pct_change().dropna()
        if len(df) < 50:
            raise ValueError("Series too short after returns alignment (minimum 50 points required)")
            
    n_obs = len(df)
    actual_max_lag = max(1, min(max_lag, n_obs // 5))
    
    # A to B (does A predict B): target=B, source=A
    data_a_to_b = df.iloc[:, [1, 0]].values
    best_lag_ab, min_p_ab, curve_ab = _granger_min_p(data_a_to_b, actual_max_lag)
    
    # B to A (does B predict A): target=A, source=B
    data_b_to_a = df.iloc[:, [0, 1]].values
    best_lag_ba, min_p_ba, curve_ba = _granger_min_p(data_b_to_a, actual_max_lag)
    
    sig_ab = min_p_ab < 0.05
    sig_ba = min_p_ba < 0.05
    
    name_a = a.name or "A"
    name_b = b.name or "B"
    
    if sig_ab and not sig_ba:
        lead = f"{name_a} leads {name_b}"
    elif sig_ba and not sig_ab:
        lead = f"{name_b} leads {name_a}"
    elif sig_ab and sig_ba:
        lead = "bidirectional feedback"
    else:
        lead = "no significant lead-lag"
        
    interpretation = f"Granger causality analysis results: {lead}."
    
    return {
        "name_a": name_a,
        "name_b": name_b,
        "max_lag": int(actual_max_lag),
        "n_obs": int(n_obs),
        "a_to_b": {
            "best_lag": int(best_lag_ab),
            "min_pvalue": _safe_float(min_p_ab),
            "significant": bool(sig_ab),
            "curve": curve_ab
        },
        "b_to_a": {
            "best_lag": int(best_lag_ba),
            "min_pvalue": _safe_float(min_p_ba),
            "significant": bool(sig_ba),
            "curve": curve_ba
        },
        "lead": lead,
        "interpretation": interpretation
    }
