import numpy as np
import pandas as pd
from fastapi import APIRouter
from backend.risk_engine.schemas import RiskSummary, ExposureAnalytics, CorrelationMatrix
from backend.risk_engine.compute import (
    ewma_volatility,
    calculate_beta,
    build_correlation_matrix,
    calculate_pca_exposures,
    marginal_risk_contribution
)

router = APIRouter(prefix="/risk", tags=["risk"])

def _get_dummy_returns_df() -> pd.DataFrame:
    """Helper to generate dummy data for the endpoints since they do not take a portfolio ID yet."""
    np.random.seed(42)
    dates = pd.date_range("2023-01-01", periods=100)
    data = np.random.normal(0.001, 0.02, size=(100, 3))
    return pd.DataFrame(data, index=dates, columns=["AAPL", "MSFT", "GOOG"])

@router.get("/summary", response_model=RiskSummary)
async def get_risk_summary():
    df = _get_dummy_returns_df()
    port_returns = df.mean(axis=1).values
    bm_returns = df.iloc[:, 0].values # Use first asset as roughly the benchmark

    vol = ewma_volatility(port_returns)
    beta = calculate_beta(port_returns, bm_returns)

    cov = df.cov().values
    weights = np.ones(3) / 3.0
    marginals = marginal_risk_contribution(weights, cov)

    mc_dict = {col: float(m) for col, m in zip(df.columns, marginals)}

    return RiskSummary(
        ewma_vol=vol,
        beta=beta,
        marginal_contribution=mc_dict
    )

@router.get("/exposures", response_model=ExposureAnalytics)
async def get_risk_exposures():
    df = _get_dummy_returns_df()
    res = calculate_pca_exposures(df, n_components=2)
    return ExposureAnalytics(
        pca_factors=res["pca_factors"],
        loadings=res["loadings"]
    )

@router.get("/correlation", response_model=CorrelationMatrix)
async def get_risk_correlation():
    df = _get_dummy_returns_df()
    res = build_correlation_matrix(df, window=60)
    return CorrelationMatrix(
        matrix=res["matrix"],
        assets=res["assets"]
    )
