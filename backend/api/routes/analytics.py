from fastapi import APIRouter, HTTPException, Query
from typing import Any, Dict

from backend.services.sector_rotation import fetch_sector_rotation

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

@router.get("/sector-rotation", response_model=Dict[str, Any])
async def get_sector_rotation(
    benchmark: str = Query("SPY", description="Benchmark symbol, e.g., SPY or ^NSEI"),
    period: str = Query("52w", description="Lookback period for trail")
):
    """Fetch Relative Rotation Graph (RRG) metrics for sector rotation analysis."""
    result = await fetch_sector_rotation(benchmark)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result
