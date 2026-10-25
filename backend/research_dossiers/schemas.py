from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import uuid4
from pydantic import BaseModel, Field, ConfigDict, field_validator


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=120)
    claim: str = Field(min_length=1, max_length=10000)
    stance: Literal["supporting", "opposing", "neutral"] = "neutral"
    source_url: str | None = Field(default=None, max_length=2000)
    source_title: str = Field(default="", max_length=500)
    quote: str = Field(default="", max_length=20000)
    published_at: datetime | None = None
    observed_at: datetime | None = None
    metric: str | None = Field(default=None, max_length=120)
    value: float | None = None
    unit: str | None = Field(default=None, max_length=40)
    document_id: int | None = None
    page: int | None = Field(default=None, ge=1)

    @field_validator("source_url")
    @classmethod
    def safe_url(cls, value):
        if value and not value.startswith(("https://", "http://")):
            raise ValueError("Source URL must use http or https")
        return value


class DossierCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    title: str = Field(min_length=1, max_length=240)
    symbol: str = Field(min_length=1, max_length=64)
    market: str = Field(default="", max_length=24)
    thesis: str = Field(default="", max_length=50000)
    assumptions: list[str] = Field(default_factory=list, max_length=100)
    catalysts: list[str] = Field(default_factory=list, max_length=100)
    invalidation_conditions: list[str] = Field(default_factory=list, max_length=100)
    evidence: list[Evidence] = Field(default_factory=list, max_length=500)
    linked_run_ids: list[str] = Field(default_factory=list, max_length=100)
    portfolio_id: str | None = Field(default=None, max_length=64)
    monitoring_enabled: bool = False
    materiality_threshold: float = Field(default=5.0, ge=0, le=1000)

    @field_validator("title", "symbol")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Must not be blank")
        return value.strip()

    @field_validator("evidence")
    @classmethod
    def unique_ids(cls, values):
        if len({e.id for e in values}) != len(values):
            raise ValueError("Evidence IDs must be unique")
        return values


class DossierUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    expected_revision: int | None = Field(default=None, ge=1)
    title: str | None = None
    symbol: str | None = None
    market: str | None = None
    thesis: str | None = None
    assumptions: list[str] | None = None
    catalysts: list[str] | None = None
    invalidation_conditions: list[str] | None = None
    evidence: list[Evidence] | None = None
    linked_run_ids: list[str] | None = None
    portfolio_id: str | None = None
    monitoring_enabled: bool | None = None
    materiality_threshold: float | None = None


class MonitorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidence: list[Evidence] | None = Field(default=None, max_length=500)

    @field_validator("evidence")
    @classmethod
    def unique_evidence_ids(cls, values):
        if values is not None and len({e.id for e in values}) != len(values):
            raise ValueError("Evidence IDs must be unique")
        return values
