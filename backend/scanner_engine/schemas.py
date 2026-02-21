from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class LiquidityGate(BaseModel):
    min_price: float = 0.0
    min_avg_volume: float = 0.0
    min_avg_traded_value: float = 0.0


class DetectorRule(BaseModel):
    type: str
    params: dict[str, Any] = Field(default_factory=dict)


class RankingConfig(BaseModel):
    mode: str = "default"
    params: dict[str, Any] = Field(default_factory=dict)


class ScanPresetBase(BaseModel):
    name: str
    universe: str
    timeframe: str = "1d"
    liquidity_gate: LiquidityGate = Field(default_factory=LiquidityGate)
    rules: list[DetectorRule] = Field(default_factory=list)
    ranking: RankingConfig = Field(default_factory=RankingConfig)


class ScanPresetCreate(ScanPresetBase):
    pass


class ScanPresetUpdate(ScanPresetBase):
    pass


class ScanPresetOut(ScanPresetBase):
    id: str
    created_at: datetime
    updated_at: datetime


class ScreenerRunRequestV1(BaseModel):
    preset_id: str | None = None
    inline_preset: ScanPresetCreate | None = None
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class ScanRunOut(BaseModel):
    id: str
    preset_id: str | None = None
    started_at: datetime
    finished_at: datetime | None = None
    status: str
    summary: dict[str, Any] = Field(default_factory=dict)


class ScanResultOut(BaseModel):
    run_id: str
    symbol: str
    setup_type: str
    score: float
    signal_ts: datetime | None = None
    levels: dict[str, Any] = Field(default_factory=dict)
    features: dict[str, Any] = Field(default_factory=dict)
    explain: dict[str, Any] = Field(default_factory=dict)
