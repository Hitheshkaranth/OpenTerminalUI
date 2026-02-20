from __future__ import annotations

from pydantic import BaseModel, Field


class PortfolioDefinitionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    universe_json: dict = Field(default_factory=dict)
    benchmark_symbol: str | None = None
    start_date: str
    end_date: str
    rebalance_frequency: str = "WEEKLY"
    weighting_method: str = "EQUAL"
    constraints_json: dict = Field(default_factory=dict)


class PortfolioDefinitionSummary(BaseModel):
    id: str
    name: str
    description: str
    tags: list[str]
    benchmark_symbol: str | None
    start_date: str
    end_date: str
    rebalance_frequency: str
    weighting_method: str
    created_at: str


class StrategyBlendCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    strategies_json: list[dict] = Field(default_factory=list)
    blend_method: str = "WEIGHTED_SUM_RETURNS"


class PortfolioRunRequest(BaseModel):
    blend_id: str | None = None
    force_refresh: bool = False


class PortfolioRunStatus(BaseModel):
    run_id: str
    portfolio_id: str
    blend_id: str | None = None
    status: str
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None


class PortfolioReport(BaseModel):
    run_id: str
    portfolio_id: str
    blend_id: str | None = None
    status: str
    metrics: dict
    series: dict
    tables: dict
    matrices: dict


class WeightingMethodEnum:
    EQUAL = "EQUAL"
    VOL_TARGET = "VOL_TARGET"
    RISK_PARITY = "RISK_PARITY"
