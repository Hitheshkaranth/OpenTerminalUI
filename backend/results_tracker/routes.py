from __future__ import annotations

from fastapi import APIRouter, Query

from backend.results_tracker import service

router = APIRouter(prefix="/api/results", tags=["results-tracker"])


@router.get("/{symbol}")
async def get_results_history(symbol: str, quarters: int = Query(default=8)) -> dict[str, object]:
    if not symbol:
        raise ValueError("symbol is required")
    cleaned = int(quarters)
    return await service.build_history(symbol, quarters=max(1, min(cleaned, 24)))


@router.get("/latest")
async def get_results_latest(
    market: str = Query(default="IN"),
    limit: int = Query(default=50),
) -> dict[str, object]:
    clean_market = str(market or "IN").upper()
    if clean_market not in ("IN", "US"):
        clean_market = "US"
    cleaned = int(limit)
    return await service.get_latest(clean_market, limit=max(1, min(cleaned, 200)))