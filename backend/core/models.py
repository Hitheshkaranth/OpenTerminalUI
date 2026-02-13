from __future__ import annotations

from typing import Any

import numpy as np
from pydantic import BaseModel, Field


class APIWarning(BaseModel):
    code: str
    message: str


class APIResponseMeta(BaseModel):
    warnings: list[APIWarning] = Field(default_factory=list)


class OhlcvPoint(BaseModel):
    t: int
    o: float
    h: float
    l: float
    c: float
    v: float


class ChartResponse(BaseModel):
    ticker: str
    interval: str
    currency: str = "INR"
    data: list[OhlcvPoint]
    meta: APIResponseMeta = Field(default_factory=APIResponseMeta)


class IndicatorPoint(BaseModel):
    t: int
    values: dict[str, float | None]


class IndicatorResponse(BaseModel):
    ticker: str
    indicator: str
    params: dict[str, Any]
    data: list[IndicatorPoint]
    meta: APIResponseMeta = Field(default_factory=APIResponseMeta)


class StockSnapshot(BaseModel):
    ticker: str
    symbol: str
    company_name: str | None = None
    sector: str | None = None
    industry: str | None = None
    current_price: float | None = None
    change_pct: float | None = None
    market_cap: float | None = None
    enterprise_value: float | None = None
    pe: float | None = None
    forward_pe_calc: float | None = None
    pb_calc: float | None = None
    ps_calc: float | None = None
    ev_ebitda: float | None = None
    roe_pct: float | None = None
    roa_pct: float | None = None
    op_margin_pct: float | None = None
    net_margin_pct: float | None = None
    rev_growth_pct: float | None = None
    eps_growth_pct: float | None = None
    div_yield_pct: float | None = None
    beta: float | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class ScreenerRuleRequest(BaseModel):
    field: str
    op: str
    value: float | str | int


class ScreenerRunRequest(BaseModel):
    rules: list[ScreenerRuleRequest]
    sort_by: str = "roe_pct"
    sort_order: str = "desc"
    limit: int = 50
    universe: str = "nse_eq"


class ScreenerRunResponse(BaseModel):
    count: int
    rows: list[dict[str, Any]]
    meta: APIResponseMeta = Field(default_factory=APIResponseMeta)


class DcfRequest(BaseModel):
    base_fcf: float
    growth_rate: float = 0.1
    discount_rate: float = 0.12
    terminal_growth: float = 0.04
    years: int = 5
    net_debt: float = 0.0
    shares_outstanding: float | None = None


class DcfResponse(BaseModel):
    enterprise_value: float
    equity_value: float
    per_share_value: float | None = None
    terminal_value: float
    projection: list[dict[str, float | int]]


class SearchResult(BaseModel):
    ticker: str
    name: str


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]


class PeerMetric(BaseModel):
    metric: str
    target_value: float
    peer_median: float | None = None
    peer_mean: float | None = None
    target_percentile: float | None = None


class PeerResponse(BaseModel):
    ticker: str
    universe: str
    metrics: list[PeerMetric]


class ErrorPayload(BaseModel):
    error: str
    detail: str


def to_python_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
            return None
        return float(value)
    return None
