from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from backend.services.fixed_income_service import FixedIncomeService, get_fixed_income_service

router = APIRouter(prefix="/api/fixed-income", tags=["fixed-income"])

@router.get("/yield-curve", response_model=Dict[str, Any])
async def get_yield_curve(
    service: FixedIncomeService = Depends(get_fixed_income_service)
):
    """Fetch current US Treasury yields."""
    data = await service.get_yield_curve()
    if "error" in data:
        raise HTTPException(status_code=500, detail=data["error"])
    return data

@router.get("/yield-curve/historical", response_model=Dict[str, Any])
async def get_historical_yield_curve(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    service: FixedIncomeService = Depends(get_fixed_income_service)
):
    """Fetch historical US Treasury yields for a specific date."""
    data = await service.get_historical_yield_curve(date)
    if "error" in data:
        raise HTTPException(status_code=500, detail=data["error"])
    return data

@router.get("/2s10s-spread-history", response_model=Dict[str, Any])
async def get_2s10s_history(
    service: FixedIncomeService = Depends(get_fixed_income_service)
):
    """Fetch 2-year vs 10-year Treasury yield spread history."""
    data = await service.get_2s10s_history()
    if "error" in data:
        raise HTTPException(status_code=500, detail=data["error"])
    return data
