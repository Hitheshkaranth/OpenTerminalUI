from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.services.forex_service import service as forex_service

router = APIRouter(prefix="/forex", tags=["forex"])

# The packet tests patch this module-level service directly.
service = forex_service


class ForexQuote(BaseModel):
    pair: str
    symbol: str
    base_currency: str
    quote_currency: str
    rate: float


class CrossRatesResponse(BaseModel):
    as_of: datetime
    base_currency: str
    currencies: list[str]
    matrix: list[list[float]]
    pair_quotes: dict[str, ForexQuote]


class ForexCandle(BaseModel):
    t: int = Field(description="Unix timestamp in seconds")
    o: float
    h: float
    l: float
    c: float
    v: int


class PairChartResponse(BaseModel):
    pair: str
    source_symbol: str
    base_currency: str
    quote_currency: str
    interval: str
    market: str
    as_of: datetime
    current_rate: float
    candles: list[ForexCandle]


class CentralBankSnapshot(BaseModel):
    currency: str
    bank: str
    policy_rate: float
    last_decision_date: date
    next_decision_date: date
    last_action: str
    last_change_bps: int
    days_since_last_decision: int
    days_until_next_decision: int
    decision_cycle: str


class CentralBanksResponse(BaseModel):
    as_of: datetime
    banks: list[CentralBankSnapshot]


@router.get("/cross-rates", response_model=CrossRatesResponse)
async def get_cross_rates() -> Any:
    try:
        return await service.get_cross_rates()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/pairs/{pair:path}", response_model=PairChartResponse)
async def get_pair_chart(
    pair: str,
    interval: str = Query(default="1d"),
    range: str = Query(default="3mo"),
) -> Any:
    try:
        return await service.get_pair_chart(pair, interval=interval, range_str=range)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/central-banks", response_model=CentralBanksResponse)
async def get_central_banks() -> Any:
    try:
        return await service.get_central_banks()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
