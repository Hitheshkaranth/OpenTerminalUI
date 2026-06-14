import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf

def estimate_covariance(returns, method: str = "sample") -> np.ndarray:
    """
    Estimate daily covariance matrix.
    
    methods:
    - "sample"      : Standard sample covariance
    - "ledoit_wolf" : Ledoit-Wolf shrinkage estimator
    - "ewma"        : Exponentially-weighted moving average covariance
    - "gerber"      : Gerber statistic covariance (Gerber et al. 2021)
    """
    if not isinstance(returns, pd.DataFrame):
        returns = pd.DataFrame(returns)
    
    n = returns.shape[1]
    
    if method == "ledoit_wolf":
        try:
            cov = LedoitWolf().fit(returns.values).covariance_
        except:
            cov = returns.cov().values
    elif method == "ewma":
        # exponentially-weighted covariance; use returns.ewm(span=60).cov() last block
        cov_df = returns.ewm(span=60).cov()
        last_date = returns.index[-1]
        cov = cov_df.loc[last_date].values
    elif method == "gerber":
        cov = _gerber_covariance(returns)
    else: # "sample" or unknown
        cov = returns.cov().values
    
    # Sanitize NaN/inf
    cov = np.nan_to_num(cov)
    
    # Add tiny ridge for stability
    cov += np.eye(n) * 1e-10
    
    # Ensure symmetric
    cov = (cov + cov.T) / 2
    
    return cov

def _gerber_covariance(returns, threshold=0.5):
    """
    Compute Gerber statistic covariance.
    """
    R = returns.values
    T, N = R.shape
    std = returns.std().values
    
    # Threshold in units of std
    H = threshold * std
    
    # Correlation matrix
    corr_gerber = np.eye(N)
    
    for i in range(N):
        for j in range(i + 1, N):
            # concordant: both > H or both < -H
            concordant = ((R[:, i] > H[i]) & (R[:, j] > H[j])) | ((R[:, i] < -H[i]) & (R[:, j] < -H[j]))
            # discordant: (one > H and other < -H) or (one < -H and other > H)
            discordant = ((R[:, i] > H[i]) & (R[:, j] < -H[j])) | ((R[:, i] < -H[i]) & (R[:, j] > H[j]))
            
            n_concordant = np.sum(concordant)
            n_discordant = np.sum(discordant)
            
            if (n_concordant + n_discordant) > 0:
                rho = (n_concordant - n_discordant) / (n_concordant + n_discordant)
            else:
                rho = 0.0
            
            corr_gerber[i, j] = rho
            corr_gerber[j, i] = rho
            
    # cov = D @ corr_gerber @ D
    D = np.diag(std)
    cov = D @ corr_gerber @ D
    
    # Make it PSD: nearest-PSD clip of eigenvalues to >=0 then rescale diagonal back to variances
    vals, vecs = np.linalg.eigh(cov)
    vals = np.maximum(vals, 0)
    cov_psd = vecs @ np.diag(vals) @ vecs.T
    
    # Rescale diagonal to maintain variances
    diag_original = np.diag(cov)
    diag_psd = np.diag(cov_psd)
    
    scaling = np.sqrt(diag_original / np.where(diag_psd > 1e-12, diag_psd, 1e-12))
    S = np.diag(scaling)
    cov_psd = S @ cov_psd @ S
    
    return cov_psd
