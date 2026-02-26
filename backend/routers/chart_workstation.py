"""
chart_workstation.py — Batch chart data endpoint for the Multi-Chart Workstation.

Fetches OHLCV data for up to 6 tickers in parallel and returns a symbol→data map.
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from backend.services.extended_hours_service import get_extended_hours_service  # noqa: PLC0415

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/charts", tags=["chart-workstation"])


class BatchTickerItem(BaseModel):
    symbol: str
    timeframe: str = "1d"
    range: str = "1y"
    market: str = "NSE"
    extended: bool = False


class BatchChartRequest(BaseModel):
    tickers: list[BatchTickerItem]

    @field_validator("tickers")
    @classmethod
    def max_six(cls, v: list) -> list:
        if len(v) > 6:
            raise ValueError("Maximum 6 tickers allowed per batch request")
        return v



def _batch_result_key(item: BatchTickerItem) -> str:
    ext_flag = "true" if item.extended else "false"
    return f"{item.market.upper()}:{item.symbol.upper()}|{item.timeframe}|{item.range or '1y'}|ext={ext_flag}"


@router.post("/batch")
async def batch_chart_data(request: BatchChartRequest) -> dict[str, Any]:
    """
    Fetch OHLCV data for up to 6 tickers in parallel.

    Returns a map of request-key -> ChartResponse-like payload.
    or {symbol, error, data: []} on failure.
    """
    results: dict[str, Any] = {}
    if not request.tickers:
        return results

    service = await get_extended_hours_service()

    async def fetch_one(item: BatchTickerItem) -> tuple[str, Any]:
        try:
            # We use the ExtendedHoursService instead of direct provider
            bars = await service.get_chart_data(
                symbol=item.symbol,
                timeframe=item.timeframe,
                market="US" if item.market.upper() in {"NYSE", "NASDAQ", "AMEX"} else "IN",
                extended=item.extended,
            )

            key = _batch_result_key(item)
            return key, {
                "ticker": item.symbol.upper(),
                "interval": item.timeframe,
                "currency": "INR" if item.market.upper() in {"NSE", "BSE", "NFO"} else "USD",
                "data": [
                    {
                        "t": b["time"],
                        "o": b["open"],
                        "h": b["high"],
                        "l": b["low"],
                        "c": b["close"],
                        "v": b["volume"],
                        "s": b.get("session", "rth"),
                        "ext": b.get("isExtended", False)
                    }
                    for b in bars
                ],
                "meta": {
                    "warnings": [],
                    "hasPreMarket": any(b.get("session") in ["pre", "pre_open"] for b in bars),
                    "hasAfterHours": any(b.get("session") in ["post", "closing"] for b in bars),
                },
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception("Batch fetch failed for %s", item.symbol)
            key = _batch_result_key(item)
            return key, {
                "ticker": item.symbol.upper(),
                "interval": item.timeframe,
                "currency": "INR" if item.market.upper() in {"NSE", "BSE", "NFO"} else "USD",
                "error": str(exc),
                "data": [],
                "meta": {"warnings": [{"code": "batch_chart_error", "message": str(exc)}]},
            }

    tasks = [fetch_one(item) for item in request.tickers]
    pairs = await asyncio.gather(*tasks)
    for symbol, data in pairs:
        results[symbol] = data

    return results
