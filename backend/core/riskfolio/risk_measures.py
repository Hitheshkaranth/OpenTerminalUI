import numpy as np
import scipy.stats as stats
from scipy.optimize import minimize_scalar

def risk_report(returns, confidence: float = 0.95, rf: float = 0.0, periods_per_year: int = 252) -> dict:
    """
    Compute risk analytics on a 1-D returns vector.
    """
    if isinstance(returns, (list, np.ndarray)):
        returns = np.array(returns)
    else:
        returns = returns.values

    # Remove NaNs
    returns = returns[~np.isnan(returns)]

    if len(returns) == 0:
        return _empty_report()

    # Annualized metrics
    mean_daily = np.mean(returns)
    expected_return = mean_daily * periods_per_year
    
    vol_daily = np.std(returns, ddof=1)
    volatility = vol_daily * np.sqrt(periods_per_year)

    # Downside deviation: RMS of returns clipped at 0 over ALL periods (not only
    # the negative ones), otherwise it collapses to ~volatility and Sortino ~= Sharpe.
    downside_deviation = float(np.sqrt(np.mean(np.minimum(returns, 0.0) ** 2)) * np.sqrt(periods_per_year))

    mad = np.mean(np.abs(returns - mean_daily))

    # VaR and CVaR (Losses are positive)
    var = -np.quantile(returns, 1 - confidence)
    var = max(0.0, var)

    tail_losses = -returns[returns <= -var]
    if len(tail_losses) > 0:
        cvar = np.mean(tail_losses)
    else:
        cvar = var
    cvar = max(var, cvar)

    # Entropic VaR (EVaR)
    def evar_objective(z, r, alpha):
        if z <= 0: return 1e10
        # EVaR = z * ln( E[exp(-R/z)] / (1-alpha) )
        # Use logsumexp trick for stability if needed, but mean(exp) is usually fine for small returns
        try:
            val = z * np.log(np.mean(np.exp(-r / z)) / (1 - alpha))
            return val
        except:
            return 1e10

    res_evar = minimize_scalar(evar_objective, args=(returns, confidence), bounds=(1e-6, 1.0), method='bounded')
    if res_evar.success:
        evar = max(var, float(res_evar.fun))
    else:
        evar = var

    # Drawdown measures (uncompounded)
    nav = np.cumsum(returns)
    running_max = np.maximum.accumulate(nav)
    dd = running_max - nav # losses/drawdowns as positive
    
    max_drawdown = np.max(dd) if len(dd) > 0 else 0.0
    avg_drawdown = np.mean(dd) if len(dd) > 0 else 0.0
    ulcer_index = np.sqrt(np.mean(dd**2)) if len(dd) > 0 else 0.0

    # CDaR (Conditional Drawdown at Risk)
    dd_threshold = np.quantile(dd, confidence) if len(dd) > 0 else 0.0
    tail_dd = dd[dd >= dd_threshold]
    cdar = np.mean(tail_dd) if len(tail_dd) > 0 else dd_threshold

    # EDaR (Entropic Drawdown at Risk)
    res_edar = minimize_scalar(evar_objective, args=(-dd, confidence), bounds=(1e-6, 1.0), method='bounded')
    # Note: evar_objective uses -r/z. If we pass -dd, it becomes dd/z.
    # But EDaR formula for dd series (which is already positive) usually applies directly.
    # Wait, the EVaR formula for returns R is inf_{z>0} z log( E[exp(-R/z)] / (1-alpha) ).
    # If X is loss (like dd), VaR_alpha(X) = inf_{z>0} z log( E[exp(X/z)] / (1-alpha) ).
    def edar_objective(z, d, alpha):
        if z <= 0: return 1e10
        try:
            return z * np.log(np.mean(np.exp(d / z)) / (1 - alpha))
        except:
            return 1e10
            
    res_edar = minimize_scalar(edar_objective, args=(dd, confidence), bounds=(1e-6, 10.0), method='bounded')
    if res_edar.success:
        edar = max(cdar, float(res_edar.fun))
    else:
        edar = cdar

    # Ratios
    sharpe = (expected_return - rf) / volatility if volatility > 1e-9 else 0.0
    sortino = (expected_return - rf) / downside_deviation if downside_deviation > 1e-9 else 0.0
    calmar = expected_return / max(max_drawdown, 1e-9)

    skew = float(stats.skew(returns)) if len(returns) > 2 else 0.0
    kurtosis = float(stats.kurtosis(returns)) if len(returns) > 2 else 0.0

    report = {
        "expected_return": expected_return,
        "volatility": volatility,
        "downside_deviation": downside_deviation,
        "mad": mad,
        "var": var,
        "cvar": cvar,
        "evar": evar,
        "max_drawdown": max_drawdown,
        "avg_drawdown": avg_drawdown,
        "ulcer_index": ulcer_index,
        "cdar": cdar,
        "edar": edar,
        "sharpe": sharpe,
        "sortino": sortino,
        "calmar": calmar,
        "skew": skew,
        "kurtosis": kurtosis
    }
    
    # Sanitize and round
    return {k: round(float(np.nan_to_num(v)), 6) for k, v in report.items()}

def _empty_report():
    keys = [
        "expected_return", "volatility", "downside_deviation", "mad", "var", "cvar", "evar",
        "max_drawdown", "avg_drawdown", "ulcer_index", "cdar", "edar", "sharpe", "sortino", 
        "calmar", "skew", "kurtosis"
    ]
    return {k: 0.0 for k in keys}
