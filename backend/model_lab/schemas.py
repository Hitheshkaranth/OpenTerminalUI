from __future__ import annotations

from pydantic import BaseModel, Field


class ExperimentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    model_key: str = Field(min_length=1, max_length=120)
    params_json: dict = Field(default_factory=dict)
    universe_json: dict = Field(default_factory=dict)
    benchmark_symbol: str | None = None
    start_date: str
    end_date: str
    cost_model_json: dict = Field(default_factory=dict)


class ExperimentSummary(BaseModel):
    id: str
    name: str
    description: str
    tags: list[str]
    model_key: str
    benchmark_symbol: str | None
    start_date: str
    end_date: str
    created_at: str


class RunMetrics(BaseModel):
    run_id: str
    metrics: dict


class RunTimeseries(BaseModel):
    run_id: str
    series: dict


class ExperimentRunRequest(BaseModel):
    force_refresh: bool = False


class CompareRequest(BaseModel):
    run_ids: list[str] = Field(min_length=2, max_length=6)


class WalkForwardRequest(BaseModel):
    train_window_days: int = Field(252, ge=30, le=2520)
    test_window_days: int = Field(63, ge=10, le=504)


class ParamSweepRequest(BaseModel):
    grid: dict[str, list[float | int | str | bool]] = Field(default_factory=dict)
    max_combinations: int = Field(32, ge=1, le=96)
