import pandas as pd
import numpy as np
import statsmodels.api as sm
from statsmodels.regression.rolling import RollingOLS
import warnings

warnings.filterwarnings("ignore")

def _safe_float(val):
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except Exception:
        return 0.0

def factor_regression(asset: pd.Series, benchmark: pd.Series, *, rolling_window: int = 63) -> dict:
    # Align asset+benchmark on common dates
    df = pd.concat([asset, benchmark], axis=1, sort=False).dropna()
    if len(df) < 60:
        raise ValueError("Series too short after alignment (minimum 60 points required)")

    # Compute daily simple returns
    returns = df.pct_change().dropna()
    if len(returns) < 30:
        raise ValueError("Series too short after returns alignment (minimum 30 overlapping rows required)")

    y = returns.iloc[:, 0]
    x = returns.iloc[:, 1]
    
    # OLS
    X = sm.add_constant(x)
    try:
        model = sm.OLS(y, X).fit()
        alpha_daily = model.params.iloc[0]
        beta = model.params.iloc[1]
        
        alpha_annual = (1 + alpha_daily) ** 252 - 1
        resid = model.resid
        tracking_error = np.std(resid) * np.sqrt(252)
        information_ratio = alpha_annual / tracking_error if tracking_error > 0 else 0.0
        
        r_squared = model.rsquared
        correlation = returns.corr().iloc[0, 1]
        
        alpha_tstat = model.tvalues.iloc[0]
        alpha_pvalue = model.pvalues.iloc[0]
        beta_tstat = model.tvalues.iloc[1]
        beta_pvalue = model.pvalues.iloc[1]
        
        # Rolling beta
        rolling_beta_list = []
        try:
            window = max(20, min(rolling_window, len(returns) // 2))
            roll = RollingOLS(y, X, window=window).fit()
            roll_params = roll.params.iloc[:, 1].dropna()
            roll_last = roll_params.tail(250)
            rolling_beta_list = [
                {"date": d.strftime("%Y-%m-%d"), "beta": _safe_float(v)}
                for d, v in roll_last.items()
            ]
        except Exception:
            rolling_beta_list = []

        # Scatter (last 300)
        scatter_data = [
            {"x": _safe_float(row.iloc[1]), "y": _safe_float(row.iloc[0])}
            for _, row in returns.tail(300).iterrows()
        ]
        
        # Fit line
        xmin = returns.iloc[:, 1].min()
        xmax = returns.iloc[:, 1].max()
        fit_line = [
            {"x": _safe_float(xmin), "y": _safe_float(alpha_daily + beta * xmin)},
            {"x": _safe_float(xmax), "y": _safe_float(alpha_daily + beta * xmax)}
        ]
        
        # Interpretation
        beta_type = "market-like"
        if beta > 1.2:
            beta_type = "high-beta"
        elif beta < 0.8:
            beta_type = "low-beta"
            
        alpha_sign = "positive" if alpha_daily > 0 else "negative"
        interpretation = f"{beta_type.capitalize()} asset with {alpha_sign} alpha. R-squared of {r_squared:.2f}."
        
        return {
            "asset": asset.name or "ASSET",
            "benchmark": benchmark.name or "BENCH",
            "alpha_daily": _safe_float(alpha_daily),
            "alpha_annual": _safe_float(alpha_annual),
            "beta": _safe_float(beta),
            "r_squared": _safe_float(r_squared),
            "correlation": _safe_float(correlation),
            "tracking_error": _safe_float(tracking_error),
            "information_ratio": _safe_float(information_ratio),
            "alpha_tstat": _safe_float(alpha_tstat),
            "alpha_pvalue": _safe_float(alpha_pvalue),
            "beta_tstat": _safe_float(beta_tstat),
            "beta_pvalue": _safe_float(beta_pvalue),
            "n_obs": int(len(returns)),
            "rolling_window": int(rolling_window),
            "rolling_beta": rolling_beta_list,
            "scatter": scatter_data,
            "fit_line": fit_line,
            "interpretation": interpretation
        }
    except Exception as e:
        # If OLS fails significantly
        return {
            "asset": asset.name or "ASSET",
            "benchmark": benchmark.name or "BENCH",
            "alpha_daily": 0.0,
            "alpha_annual": 0.0,
            "beta": 0.0,
            "r_squared": 0.0,
            "correlation": 0.0,
            "tracking_error": 0.0,
            "information_ratio": 0.0,
            "alpha_tstat": 0.0,
            "alpha_pvalue": 1.0,
            "beta_tstat": 0.0,
            "beta_pvalue": 1.0,
            "n_obs": 0,
            "rolling_window": int(rolling_window),
            "rolling_beta": [],
            "scatter": [],
            "fit_line": [],
            "interpretation": f"Regression failed: {str(e)}"
        }
