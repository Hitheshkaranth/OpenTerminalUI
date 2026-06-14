import numpy as np
import pandas as pd
from scipy.optimize import minimize, linprog
from .risk_measures import risk_report
from .hrp import hrp_weights
from .black_litterman import bl_posterior_returns
from .covariance import estimate_covariance

def optimize_portfolio(returns, *, model="Classic", objective="max_sharpe", risk_measure="MV",
                       confidence=0.95, rf=0.0, risk_aversion=2.0, min_weight=0.0, max_weight=1.0,
                       target_return=None, views=None, periods_per_year=252, cov_method="sample") -> dict:
    """
    Mean-risk optimization using scipy.
    """
    symbols = returns.columns.tolist()
    n = len(symbols)
    mu = returns.mean().values
    cov = estimate_covariance(returns, cov_method)
    
    # Handle BL model
    if model == "BL":
        w_market = np.ones(n) / n
        P = []
        Q = []
        if views:
            for v in views:
                p_row = np.zeros(n)
                for i, sym in enumerate(symbols):
                    if sym in v["assets"]:
                        # If weights provided in view, use them, else assume equal weight among view assets
                        if "weights" in v:
                            p_row[i] = v["weights"][v["assets"].index(sym)]
                        else:
                            p_row[i] = 1.0 / len(v["assets"])
                P.append(p_row)
                Q.append(v["value"])
        
        mu, cov = bl_posterior_returns(cov, w_market, P, Q, risk_aversion=risk_aversion)
        model = "Classic" # Continue with BL-adjusted mu/cov

    if model in ["HRP", "HERC"]:
        weights_dict = hrp_weights(returns, risk_measure=risk_measure)
        w = np.array([weights_dict[sym] for sym in symbols])
    elif model == "RP":
        from .risk_parity import risk_parity_weights
        weights_dict = risk_parity_weights(returns, cov_method=cov_method, 
                                           min_weight=min_weight, max_weight=max_weight)
        w = np.array([weights_dict[sym] for sym in symbols])
    elif model == "NCO":
        from .nco import nco_weights
        weights_dict = nco_weights(returns, objective=objective, risk_measure=risk_measure,
                                   cov_method=cov_method, min_weight=min_weight, max_weight=max_weight)
        w = np.array([weights_dict[sym] for sym in symbols])
    else:
        # Classic Optimization
        w = _solve_classic(returns, mu, cov, objective, risk_measure, confidence, rf, 
                           risk_aversion, min_weight, max_weight, target_return, periods_per_year)

    # Prepare output
    portfolio_returns = returns @ w
    metrics = risk_report(portfolio_returns, confidence=confidence, rf=rf, periods_per_year=periods_per_year)
    
    # Risk contributions (Variance based)
    p_var = w.T @ cov @ w
    if p_var > 1e-9:
        risk_contribs = (w * (cov @ w)) / p_var
    else:
        risk_contribs = np.ones(n) / n
        
    asset_metrics = []
    for i, sym in enumerate(symbols):
        asset_metrics.append({
            "symbol": sym,
            "annual_return": round(float(mu[i] * periods_per_year), 6),
            "annual_vol": round(float(np.sqrt(cov[i, i] * periods_per_year)), 6),
            "weight": round(float(w[i]), 6)
        })

    return {
        "weights": {sym: round(float(w[i]), 6) for i, sym in enumerate(symbols)},
        "metrics": metrics,
        "risk_contributions": {sym: round(float(risk_contribs[i]), 6) for i, sym in enumerate(symbols)},
        "asset_metrics": asset_metrics,
        "model": model,
        "objective": objective,
        "risk_measure": risk_measure
    }

def _solve_classic(returns, mu, cov, objective, risk_measure, confidence, rf,
                  risk_aversion, min_weight, max_weight, target_return, periods_per_year):
    n = len(mu)
    rf_daily = rf / periods_per_year
    R = returns.values
    
    # Constraints
    cons = [{'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0}]
    if target_return is not None:
        cons.append({'type': 'eq', 'fun': lambda w: np.sum(w * mu) * periods_per_year - target_return})
        
    bounds = [(min_weight, max_weight) for _ in range(n)]
    w0 = np.ones(n) / n

    def get_risk(w):
        if risk_measure == "MV":
            return np.sqrt(w.T @ cov @ w) * np.sqrt(periods_per_year)
        else:
            p_ret = R @ w
            rep = risk_report(p_ret, confidence=confidence, periods_per_year=periods_per_year)
            # Map risk_measure ID to report key
            key_map = {"MAD": "mad", "CVaR": "cvar", "CDaR": "cdar", "MDD": "max_drawdown", "ULCER": "ulcer_index"}
            return rep.get(key_map.get(risk_measure, "volatility"), rep["volatility"])

    if objective == "min_risk":
        res = minimize(get_risk, w0, method='SLSQP', bounds=bounds, constraints=cons)
    elif objective == "max_return":
        # Scale by periods_per_year so the (tiny daily) gradient is large enough for SLSQP to
        # leave the equal-weight start; otherwise it stalls and returns w0 (collapsing the frontier).
        res = minimize(lambda w: -np.sum(w * mu) * periods_per_year, w0, method='SLSQP', bounds=bounds, constraints=cons)
    elif objective == "utility":
        res = minimize(lambda w: -(np.sum(w * mu) * periods_per_year - 0.5 * risk_aversion * (get_risk(w)**2)), 
                       w0, method='SLSQP', bounds=bounds, constraints=cons)
    elif objective == "max_sharpe":
        def neg_sharpe(w):
            vol = get_risk(w)
            ret = np.sum(w * mu) * periods_per_year
            if vol < 1e-9: return 0.0
            return -(ret - rf) / vol
        res = minimize(neg_sharpe, w0, method='SLSQP', bounds=bounds, constraints=cons)
        # Try a few restarts
        for _ in range(3):
            w_rand = np.random.dirichlet(np.ones(n))
            res_rand = minimize(neg_sharpe, w_rand, method='SLSQP', bounds=bounds, constraints=cons)
            if res_rand.success and res_rand.fun < res.fun:
                res = res_rand
    else:
        res = minimize(get_risk, w0, method='SLSQP', bounds=bounds, constraints=cons)

    return res.x

def efficient_frontier(returns, *, points=20, rf=0.0, min_weight=0.0, max_weight=1.0,
                       risk_measure="MV", confidence=0.95, periods_per_year=252, cov_method="sample") -> list[dict]:
    """
    Compute efficient frontier points.
    """
    mu = returns.mean().values * periods_per_year
    
    # Min risk portfolio
    min_risk_res = optimize_portfolio(returns, objective="min_risk", risk_measure=risk_measure,
                                     min_weight=min_weight, max_weight=max_weight, 
                                     confidence=confidence, periods_per_year=periods_per_year,
                                     cov_method=cov_method)
    min_ret = min_risk_res["metrics"]["expected_return"]
    
    # Max return portfolio (subject to bounds)
    max_ret_res = optimize_portfolio(returns, objective="max_return", risk_measure=risk_measure,
                                    min_weight=min_weight, max_weight=max_weight,
                                    confidence=confidence, periods_per_year=periods_per_year,
                                    cov_method=cov_method)
    max_ret = max_ret_res["metrics"]["expected_return"]
    
    if max_ret <= min_ret:
        # Just return the two points if they are same or inverted
        return [{"risk": min_risk_res["metrics"]["volatility"], 
                 "return": min_risk_res["metrics"]["expected_return"],
                 "sharpe": min_risk_res["metrics"]["sharpe"]}]

    target_returns = np.linspace(min_ret, max_ret, points)
    frontier = []
    
    for tr in target_returns:
        try:
            res = optimize_portfolio(returns, objective="min_risk", risk_measure=risk_measure,
                                     target_return=tr, min_weight=min_weight, max_weight=max_weight,
                                     confidence=confidence, periods_per_year=periods_per_year,
                                     cov_method=cov_method)
            frontier.append({
                "risk": res["metrics"]["volatility"],
                "return": res["metrics"]["expected_return"],
                "sharpe": res["metrics"]["sharpe"]
            })
        except:
            continue
            
    return sorted(frontier, key=lambda x: x["risk"])
