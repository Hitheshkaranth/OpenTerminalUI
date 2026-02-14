from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from backend.fno.services.pcr_tracker import get_pcr_tracker

router = APIRouter()


@router.get("/fno/pcr/{symbol}")
async def pcr_current(symbol: str, expiry: str | None = Query(default=None)) -> dict[str, Any]:
    tracker = get_pcr_tracker()
    return await tracker.get_current_pcr(symbol, expiry=expiry)


@router.get("/fno/pcr/{symbol}/history")
async def pcr_history(symbol: str, days: int = Query(default=30, ge=1, le=365)) -> dict[str, Any]:
    tracker = get_pcr_tracker()
    items = await tracker.get_pcr_history(symbol, days=days)
    return {"symbol": symbol.strip().upper(), "days": days, "items": items}


@router.get("/fno/pcr/{symbol}/by-strike")
async def pcr_by_strike(symbol: str, expiry: str | None = Query(default=None)) -> dict[str, Any]:
    tracker = get_pcr_tracker()
    items = await tracker.get_pcr_by_strike(symbol, expiry=expiry)
    return {"symbol": symbol.strip().upper(), "expiry": expiry, "items": items}
