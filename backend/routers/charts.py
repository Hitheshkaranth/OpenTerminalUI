
from fastapi import APIRouter, Depends
from typing import Optional
from backend.services.extended_hours_service import get_extended_hours_service, ExtendedHoursService

router = APIRouter(prefix="/api/charts", tags=["charts"])

@router.get("/{ticker}")
async def get_chart_data(
    ticker: str,
    timeframe: str = "1D",
    extended: bool = False,
    session_filter: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    market: str = "IN",
    service: ExtendedHoursService = Depends(get_extended_hours_service),
):
    """
    Returns OHLCV chart data with optional extended hours.
    """
    bars = await service.get_chart_data(
        symbol=ticker,
        timeframe=timeframe,
        market=market,
        extended=extended,
        date_from=date_from,
        date_to=date_to,
    )

    if session_filter and session_filter != "all":
        sessions = session_filter.split(",")
        bars = [b for b in bars if b.get("session") in sessions]

    return {
        "ticker": ticker,
        "timeframe": timeframe,
        "market": market,
        "extended": extended,
        "bars": bars,
        "sessionMeta": {
            "hasPreMarket": any(b.get("session") in ["pre", "pre_open"] for b in bars),
            "hasAfterHours": any(b.get("session") in ["post", "closing"] for b in bars),
            "preMarketBars": sum(1 for b in bars if b.get("session") in ["pre", "pre_open"]),
            "afterHoursBars": sum(1 for b in bars if b.get("session") in ["post", "closing"]),
        }
    }
