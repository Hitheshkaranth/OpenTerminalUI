from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query
from backend.services.economic_data import EconomicDataService, get_economic_data_service

router = APIRouter(prefix="/api/economics", tags=["economics"])

@router.get("/calendar", response_model=List[Dict[str, Any]])
async def get_economic_calendar(
    start: str = Query(..., alias="from"),
    end: str = Query(..., alias="to"),
    service: EconomicDataService = Depends(get_economic_data_service)
):
    """Fetch and normalize economic calendar events."""
    data = await service.get_economic_calendar(start, end)
    if isinstance(data, dict) and "error" in data:
        raise HTTPException(status_code=500, detail=data["error"])
    return data

@router.get("/indicators", response_model=Dict[str, Any])
async def get_macro_indicators(
    service: EconomicDataService = Depends(get_economic_data_service)
):
    """Fetch key macro indicators for main regions."""
    data = await service.get_macro_indicators()
    if isinstance(data, dict) and "error" in data:
        raise HTTPException(status_code=500, detail=data["error"])
    return data
