from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.services.hotlist_service import HotlistService, get_hotlist_service

router = APIRouter()


class HotlistItem(BaseModel):
    symbol: str
    name: str
    price: float
    change: float
    change_pct: float
    volume: int
    sparkline: list[float] = Field(default_factory=list)


class HotlistResponse(BaseModel):
    list_type: str
    market: str
    items: list[HotlistItem] = Field(default_factory=list)
    updated_at: datetime


@router.get("/hotlists", response_model=HotlistResponse)
async def get_hotlist(
    list_type: str = Query(...),
    market: str = Query("IN"),
    limit: int = Query(20, ge=1, le=50),
    service: HotlistService = Depends(get_hotlist_service),
) -> HotlistResponse:
    try:
        items = await service.get_hotlist(list_type=list_type, market=market, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return HotlistResponse(
        list_type=str(list_type).strip().lower(),
        market=str(market).strip().upper(),
        items=[HotlistItem(**row) for row in items],
        updated_at=datetime.utcnow(),
    )
