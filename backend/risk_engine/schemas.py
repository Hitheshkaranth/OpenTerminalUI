from typing import List, Dict, Optional, Union
from pydantic import BaseModel


class RiskSummary(BaseModel):
    ewma_vol: float
    # None when the benchmark series could not be loaded (never a fabricated 1.0).
    beta: Optional[float] = None
    benchmark_unavailable: bool = False
    marginal_contribution: Dict[str, float]


class ExposureAnalytics(BaseModel):
    pca_factors: List[Dict[str, Union[float, str]]]
    loadings: Dict[str, List[float]]


class CorrelationMatrix(BaseModel):
    matrix: List[List[float]]
    assets: List[str]
