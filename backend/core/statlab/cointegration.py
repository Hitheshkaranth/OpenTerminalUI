import pandas as pd
import numpy as np
import statsmodels.api as sm
from statsmodels.tsa.stattools import coint

def _safe_float(val):
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except:
        return 0.0

def cointegration_analysis(a, b, *, entry_z: float = 2.0, exit_z: float = 0.5) -> dict:
    # Align a, b
    df = pd.concat([a, b], axis=1).dropna()
    if len(df) < 30:
        raise ValueError("Series too short after alignment (minimum 30 points required)")
    
    ticker_a = a.name or "A"
    ticker_b = b.name or "B"
    s1 = df.iloc[:, 0]
    s2 = df.iloc[:, 1]

    # Engle-Granger
    try:
        score, pvalue, _ = coint(s1, s2)
    except:
        pvalue = 1.0

    # Hedge Ratio via OLS
    try:
        model = sm.OLS(s1, sm.add_constant(s2)).fit()
        beta = model.params.iloc[1]
        alpha = model.params.iloc[0]
        spread = s1 - beta * s2 - alpha
    except:
        beta = 0.0
        spread = s1 - s2

    # Z-score (60-obs rolling)
    rolling_mean = spread.rolling(window=min(60, len(spread))).mean()
    rolling_std = spread.rolling(window=min(60, len(spread))).std()
    
    # Fallback to full sample for initial points or if rolling fails
    zscore = (spread - rolling_mean) / rolling_std
    zscore = zscore.fillna((spread - spread.mean()) / spread.std())
    
    current_z = _safe_float(zscore.iloc[-1])
    
    # Half-life
    try:
        delta_spread = spread.diff().dropna()
        lag_spread = spread.shift(1).dropna()
        # Align them
        y = delta_spread
        x = sm.add_constant(lag_spread.loc[y.index])
        res = sm.OLS(y, x).fit()
        coef = res.params.iloc[1]
        if coef < 0:
            half_life = _safe_float(-np.log(2) / coef)
        else:
            half_life = 0.0
    except:
        half_life = 0.0

    # Signal
    if current_z >= entry_z:
        signal = "SHORT_SPREAD"
    elif current_z <= -entry_z:
        signal = "LONG_SPREAD"
    elif abs(current_z) <= exit_z:
        signal = "FLAT"
    else:
        signal = "HOLD"

    correlation = _safe_float(s1.corr(s2))

    # Series (last 250)
    subset_len = 250
    series_dates = df.index[-subset_len:]
    series_spread = spread.iloc[-subset_len:]
    series_z = zscore.iloc[-subset_len:]
    
    series_json = [
        {
            "date": d.strftime("%Y-%m-%d"),
            "spread": _safe_float(series_spread.iloc[i]),
            "zscore": _safe_float(series_z.iloc[i])
        }
        for i, d in enumerate(series_dates)
    ]

    return {
        "ticker_a": str(ticker_a),
        "ticker_b": str(ticker_b),
        "coint_pvalue": _safe_float(pvalue),
        "is_cointegrated": bool(pvalue < 0.05),
        "hedge_ratio": _safe_float(beta),
        "half_life": _safe_float(half_life),
        "current_z": current_z,
        "correlation": correlation,
        "signal": signal,
        "series": series_json
    }
