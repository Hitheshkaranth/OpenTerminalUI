import numpy as np
import pandas as pd
from .clustering import cluster_assets

def nco_weights(returns, *, objective: str = "min_risk", risk_measure: str = "MV",
                cov_method: str = "sample", min_weight: float = 0.0, max_weight: float = 1.0) -> dict:
    """
    Nested Clustered Optimization (López de Prado).
    """
    from .optimization import optimize_portfolio # Lazy import to avoid circular dependency
    
    symbols = returns.columns.tolist()
    n = len(symbols)
    
    try:
        # 1. Cluster assets
        clustering = cluster_assets(returns)
        groups = clustering["groups"]
        
        if len(groups) <= 1:
            # If only one cluster, NCO is just classic optimization
            res = optimize_portfolio(returns, model="Classic", objective=objective, 
                                     risk_measure=risk_measure, cov_method=cov_method,
                                     min_weight=min_weight, max_weight=max_weight)
            return res["weights"]
            
        # 2. Intra-cluster optimization
        intra_weights = {} # asset -> weight in its cluster
        cluster_returns = pd.DataFrame()
        
        for group in groups:
            group_syms = group["symbols"]
            sub_returns = returns[group_syms]
            
            # Optimize within cluster
            res_sub = optimize_portfolio(sub_returns, model="Classic", objective=objective,
                                         risk_measure=risk_measure, cov_method=cov_method,
                                         min_weight=0.0, max_weight=1.0) # Local unconstrained-ish
            
            w_sub = np.array([res_sub["weights"][s] for s in group_syms])
            intra_weights.update(res_sub["weights"])
            
            # Reduced cluster returns series
            cluster_returns[group["id"]] = sub_returns @ w_sub
            
        # 3. Inter-cluster optimization
        res_inter = optimize_portfolio(cluster_returns, model="Classic", objective=objective,
                                       risk_measure=risk_measure, cov_method=cov_method,
                                       min_weight=0.0, max_weight=1.0)
        inter_weights = res_inter["weights"] # cluster_id -> weight
        
        # 4. Final asset weight = inter_weight[cluster] * intra_weight[asset]
        final_weights = {}
        for group in groups:
            cid = group["id"]
            cw = inter_weights[cid]
            for s in group["symbols"]:
                final_weights[s] = cw * intra_weights[s]
                
        # 5. Renormalize to sum 1, clip to [min_weight, max_weight] then renormalize
        w_vals = np.array([final_weights[s] for s in symbols])
        w_vals = np.clip(w_vals, min_weight, max_weight)
        if np.sum(w_vals) > 1e-12:
            w_vals = w_vals / np.sum(w_vals)
        else:
            w_vals = np.ones(n) / n
            
        return {symbols[i]: round(float(w_vals[i]), 6) for i in range(n)}
        
    except Exception as e:
        # Fallback to equal weight
        return {s: round(1.0 / n, 6) for s in symbols}
