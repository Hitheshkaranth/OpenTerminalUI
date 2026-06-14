import pandas as pd
import numpy as np
import warnings
from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression

warnings.filterwarnings("ignore")

def _safe_float(val):
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except Exception:
        return 0.0

def regime_detection(prices: pd.Series, *, k_regimes: int = 2) -> dict:
    if len(prices) < 60:
        raise ValueError("Series too short (minimum 60 points required)")
    
    # Ensure DatetimeIndex, sort, drop duplicates
    if not isinstance(prices.index, pd.DatetimeIndex):
        prices.index = pd.to_datetime(prices.index)
    prices = prices.sort_index()
    prices = prices[~prices.index.duplicated(keep='last')]
    
    returns = prices.pct_change().dropna() * 100.0
    if len(returns) < 50:
        raise ValueError("Series too short after returns calculation (minimum 50 points required)")

    # Force k_regimes = 2 as requested
    k = 2
    try:
        model = MarkovRegression(returns, k_regimes=k, trend="c", switching_variance=True)
        res = model.fit()
        
        # Identify high vs low volatility regime
        # res.params contains sigma2[0], sigma2[1]
        v0 = res.params.get("sigma2[0]", 0.0)
        v1 = res.params.get("sigma2[1]", 0.0)
        
        high_idx = 1 if v1 > v0 else 0
        low_idx = 1 - high_idx
        
        high_vol_prob = res.smoothed_marginal_probabilities.iloc[:, high_idx]
        
        series_data = [
            {"date": d.strftime("%Y-%m-%d"), "high_vol_prob": _safe_float(v)}
            for d, v in high_vol_prob.tail(300).items()
        ]
        
        # Regime stats
        regimes = res.smoothed_marginal_probabilities.idxmax(axis=1)
        
        def get_regime_stats(idx, label):
            mask = regimes == idx
            subset = returns[mask]
            if len(subset) == 0:
                return {"label": label, "ann_vol_pct": 0.0, "mean": 0.0, "vol": 0.0, "share": 0.0}
            
            mu = subset.mean()
            vol = subset.std()
            share = len(subset) / len(returns)
            return {
                "label": label,
                "ann_vol_pct": _safe_float(vol * np.sqrt(252)),
                "mean": _safe_float(mu),
                "vol": _safe_float(vol),
                "share": _safe_float(share)
            }
            
        high_vol_stats = get_regime_stats(high_idx, "HIGH-VOL")
        low_vol_stats = get_regime_stats(low_idx, "LOW-VOL")
        
        current_prob = high_vol_prob.iloc[-1]
        current_regime = "HIGH-VOL" if current_prob > 0.5 else "LOW-VOL"
        
        interpretation = f"Currently in a {current_regime} regime (prob={current_prob:.2f})."
        
        return {
            "k_regimes": k,
            "n_obs": int(len(returns)),
            "current_regime": current_regime,
            "current_high_vol_prob": _safe_float(current_prob),
            "high_vol_regime": high_vol_stats,
            "low_vol_regime": low_vol_stats,
            "series": series_data,
            "interpretation": interpretation
        }
    except Exception as e:
        raise ValueError(f"Markov regime model failed to converge: {str(e)}")
