from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from backend.breakout_engine.detectors import detect_pattern
from backend.services.breakout_builder_service import (
    BreakoutBuilderValidationError,
    evaluate_builder_breakout,
    get_breakout_builder_service,
)
from backend.services.breakout_occurrence_service import get_breakout_occurrence_service
from backend.services.breakout_scanner_service import get_breakout_scanner_service

router = APIRouter()


class DetectRequest(BaseModel):
    symbol: str
    candles: list[dict[str, Any]] = Field(default_factory=list)
    pattern: str = "range_breakout_up"
    lookback: int = Field(default=20, ge=3, le=200)
    min_volume_ratio: float = Field(default=1.2, ge=1.0, le=10.0)

    @field_validator("symbol")
    @classmethod
    def _validate_symbol(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("symbol is required")
        return normalized


class ScanItem(BaseModel):
    symbol: str
    candles: list[dict[str, Any]] = Field(default_factory=list)


class ScanRequest(BaseModel):
    items: list[ScanItem] = Field(default_factory=list)
    patterns: list[str] = Field(default_factory=lambda: ["range_breakout_up", "range_breakdown_down", "volume_spike_breakout"])
    lookback: int = Field(default=20, ge=3, le=200)
    min_volume_ratio: float = Field(default=1.2, ge=1.0, le=10.0)
    min_confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class BuilderValidateRequest(BaseModel):
    dsl: str


class BuilderSaveRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    dsl: str = Field(min_length=1)


class BuilderEvaluateRequest(BaseModel):
    symbol: str
    candles: list[dict[str, Any]] = Field(default_factory=list)
    dsl: str
    lookback: int = Field(default=20, ge=3, le=200)


class OccurrenceRequest(BaseModel):
    symbol: str
    candles: list[dict[str, Any]] = Field(default_factory=list)
    pattern: str = "range_breakout_up"
    lookback: int = Field(default=20, ge=3, le=200)
    min_volume_ratio: float = Field(default=1.2, ge=1.0, le=10.0)


@router.post("/breakouts/detect")
async def detect_breakout(payload: DetectRequest) -> dict[str, Any]:
    signal = detect_pattern(
        payload.candles,
        payload.pattern,
        lookback=payload.lookback,
        min_volume_ratio=payload.min_volume_ratio,
    )
    return {
        "symbol": payload.symbol,
        "signal": signal,
    }


@router.post("/breakouts/scan")
async def scan_breakouts(payload: ScanRequest) -> dict[str, Any]:
    scanner = get_breakout_scanner_service()
    rows = scanner.scan(
        [item.model_dump() for item in payload.items],
        patterns=[str(p).strip().lower() for p in payload.patterns],
        lookback=payload.lookback,
        min_volume_ratio=payload.min_volume_ratio,
        min_confidence=payload.min_confidence,
    )
    return {
        "count": len(rows),
        "rows": rows,
        "meta": {
            "lookback": payload.lookback,
            "min_volume_ratio": payload.min_volume_ratio,
            "min_confidence": payload.min_confidence,
        },
    }


@router.post("/breakouts/builder/validate")
def validate_builder(payload: BuilderValidateRequest) -> dict[str, Any]:
    service = get_breakout_builder_service()
    try:
        return service.validate(payload.dsl)
    except BreakoutBuilderValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/breakouts/builder/save")
def save_builder(payload: BuilderSaveRequest) -> dict[str, Any]:
    service = get_breakout_builder_service()
    try:
        return service.save(payload.name, payload.dsl)
    except BreakoutBuilderValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/breakouts/builder")
def list_builders() -> dict[str, Any]:
    service = get_breakout_builder_service()
    return {"items": service.list()}


@router.get("/breakouts/builder/{builder_id}")
def get_builder(builder_id: str) -> dict[str, Any]:
    service = get_breakout_builder_service()
    row = service.get(builder_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Builder not found")
    return row


@router.post("/breakouts/builder/evaluate")
def evaluate_builder(payload: BuilderEvaluateRequest) -> dict[str, Any]:
    try:
        return {
            "symbol": payload.symbol.strip().upper(),
            "result": evaluate_builder_breakout(
                payload.candles,
                payload.dsl,
                lookback=payload.lookback,
            ),
        }
    except BreakoutBuilderValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/breakouts/occurrences")
async def track_occurrences(payload: OccurrenceRequest) -> dict[str, Any]:
    service = get_breakout_occurrence_service()
    return await service.track(
        symbol=payload.symbol,
        candles=payload.candles,
        pattern=payload.pattern,
        lookback=payload.lookback,
        min_volume_ratio=payload.min_volume_ratio,
    )
