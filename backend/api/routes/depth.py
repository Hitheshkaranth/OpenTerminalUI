from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.services.orderbook_service import service as orderbook_service

router = APIRouter(prefix="/depth", tags=["depth"])

service = orderbook_service


class DepthLevelResponse(BaseModel):
    price: float
    quantity: int
    size: int
    orders: int
    cumulative_qty: int


class DepthSnapshotResponse(BaseModel):
    symbol: str
    market: str
    provider_key: str
    as_of: datetime
    mid_price: float
    spread: float
    spread_pct: float
    tick_size: float
    levels: int
    total_bid_quantity: int
    total_ask_quantity: int
    total_bid_qty: float
    total_ask_qty: float
    last_price: float
    last_qty: float
    imbalance: float
    bids: list[DepthLevelResponse] = Field(default_factory=list)
    asks: list[DepthLevelResponse] = Field(default_factory=list)


@router.get("/{symbol}", response_model=DepthSnapshotResponse)
def get_depth_snapshot(
    symbol: str,
    market: str = Query(default="US"),
    levels: int = Query(default=20, ge=1, le=40),
) -> Any:
    try:
        snapshot = service.get_snapshot(symbol, market_hint=market, levels=levels)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return snapshot.to_wire()
