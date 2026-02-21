import numpy as np
import pandas as pd

def ewma_volatility(returns: np.ndarray, span: int = 60) -> float:
    if len(returns) == 0:
        return 0.0
    series = pd.Series(returns)
    ewma_var = series.ewm(span=span).var().iloc[-1]
    return float(np.sqrt(ewma_var)) if not pd.isna(ewma_var) else 0.0

def calculate_beta(asset_returns: np.ndarray, benchmark_returns: np.ndarray) -> float:
    if len(asset_returns) < 2 or len(benchmark_returns) < 2:
        return 1.0
    cov = np.cov(asset_returns, benchmark_returns)[0, 1]
    var_bm = np.var(benchmark_returns, ddof=1)
    if var_bm == 0:
        return 1.0
    return float(cov / var_bm)

def build_correlation_matrix(returns_df: pd.DataFrame, window: int = 60) -> dict:
    if len(returns_df) < window:
        window = max(2, len(returns_df))
    if len(returns_df) < 2:
        dim = len(returns_df.columns)
        return {"matrix": np.eye(dim).tolist() if dim > 0 else [], "assets": list(returns_df.columns)}

    corr = returns_df.tail(window).corr().fillna(0.0)
    # Ensure correlation bounds [-1, 1]
    corr = np.clip(corr, -1.0, 1.0)
    return {
        "matrix": corr.values.tolist(),
        "assets": list(corr.columns)
    }

def calculate_pca_exposures(returns_df: pd.DataFrame, n_components: int = 3) -> dict:
    if len(returns_df) < 2 or returns_df.shape[1] < 2:
        return {"pca_factors": [], "loadings": {}}

    # 1. Standardize correctly for deterministic SVD
    # Fill NAs
    df = returns_df.fillna(0.0)
    data = df.values
    data = data - np.mean(data, axis=0)
    stds = np.std(data, axis=0)
    stds[stds == 0] = 1.0
    data = data / stds

    # 2. PCA via SVD
    U, S, Vt = np.linalg.svd(data, full_matrices=False)

    # 3. Deterministic sign fix for PCA (largest magnitude element in each vector is positive)
    max_abs_cols = np.argmax(np.abs(Vt), axis=1)
    signs = np.sign(Vt[range(len(Vt)), max_abs_cols])
    Vt *= signs[:, np.newaxis]

    factors = []
    loadings = {}
    for i in range(min(n_components, len(S))):
        variance_explained = float(S[i]**2 / np.sum(S**2)) if np.sum(S**2) > 0 else 0.0
        factors.append({"factor": f"PC{i+1}", "variance_explained": variance_explained})

    for i, col in enumerate(df.columns):
        loadings[col] = [float(Vt[j, i]) for j in range(min(n_components, len(Vt)))]

    return {"pca_factors": factors, "loadings": loadings}

def marginal_risk_contribution(weights: np.ndarray, cov_matrix: np.ndarray) -> np.ndarray:
    if len(weights) == 0:
        return np.array([])
    port_var = np.dot(weights.T, np.dot(cov_matrix, weights))
    if port_var == 0:
        return np.zeros_like(weights)
    marginals = np.dot(cov_matrix, weights) / np.sqrt(port_var)
    return marginals
