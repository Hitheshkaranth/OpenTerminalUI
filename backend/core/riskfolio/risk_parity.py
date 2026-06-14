import numpy as np
import pandas as pd
from scipy.optimize import minimize
from .covariance import estimate_covariance

def risk_parity_weights(returns, *, budget=None, cov_method: str = "sample",
                        min_weight: float = 0.0, max_weight: float = 1.0) -> dict:
    """
    Equal/target Risk Contribution (ERC) long-only portfolio.
    """
    symbols = returns.columns.tolist()
    n = len(symbols)
    cov = estimate_covariance(returns, cov_method)
    
    if budget is None:
        budget = np.ones(n) / n
    else:
        budget = np.array(budget)
        budget = budget / np.sum(budget)
    
    # Start from inverse-variance weights
    v = np.diag(cov)
    w0 = (1.0 / v) / np.sum(1.0 / v)
    
    def objective(w):
        # Risk contribution: rc = w * (cov @ w)
        # Total risk: tr = w.T @ cov @ w
        # Relative risk contribution: rrc = rc / tr
        # Objective: minimize sum( (rrc - budget)**2 )
        rc = w * (cov @ w)
        tr = np.sum(rc)
        if tr < 1e-12:
            return 0.0
        rrc = rc / tr
        return np.sum((rrc - budget)**2)
    
    cons = [{'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0}]
    bounds = [(min_weight, max_weight) for _ in range(n)]
    
    res = minimize(objective, w0, method='SLSQP', bounds=bounds, constraints=cons, tol=1e-10)
    
    # Restarts if needed
    if not res.success:
        for _ in range(3):
            w_rand = np.random.dirichlet(np.ones(n))
            res_rand = minimize(objective, w_rand, method='SLSQP', bounds=bounds, constraints=cons, tol=1e-10)
            if res_rand.success and res_rand.fun < res.fun:
                res = res_rand
                
    if not res.success:
        # Fallback to inverse-variance
        w = w0
    else:
        w = res.x
        
    # Final normalization and rounding
    w = np.clip(w, min_weight, max_weight)
    w = w / np.sum(w)
    
    return {sym: round(float(w[i]), 6) for i, sym in enumerate(symbols)}
