from typing import List, Dict, Union
from pydantic import BaseModel


class RiskSummary(BaseModel):
    ewma_vol: float
    beta: float
    marginal_contribution: Dict[str, float]


class ExposureAnalytics(BaseModel):
    pca_factors: List[Dict[str, Union[float, str]]]
    loadings: Dict[str, List[float]]


class CorrelationMatrix(BaseModel):
    matrix: List[List[float]]
    assets: List[str]
