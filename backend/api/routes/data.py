from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.core.historical_data_service import get_historical_data_service

router = APIRouter()


@router.get("/data/ohlcv")
async def get_ohlcv(
    symbol: str = Query(..., min_length=1),
    market: str = Query("NSE"),
    start: str | None = None,
    end: str | None = None,
    limit: int = Query(500, ge=1, le=5000),
) -> dict[str, Any]:
    try:
        if not end:
            end = datetime.utcnow().strftime("%Y-%m-%d")
        if not start:
            start = (datetime.utcnow() - timedelta(days=365 * 5)).strftime("%Y-%m-%d")
        service = get_historical_data_service()
        normalized, bars = service.fetch_daily_ohlcv(
            raw_symbol=symbol,
            market=market,
            start=start,
            end=end,
            limit=limit,
        )
    except Exception as exc:  # pragma: no cover - defensive route guard
        raise HTTPException(status_code=400, detail=f"Failed to fetch OHLCV: {exc}") from exc

    return {
        "symbol": normalized.canonical,
        "market": normalized.market,
        "provider_symbol": normalized.provider_symbol,
        "start": start,
        "end": end,
        "bars": [
            {
                "date": b.date,
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume,
            }
            for b in bars
        ],
    }
