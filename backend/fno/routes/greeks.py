from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from backend.fno.services.greeks_engine import get_greeks_engine
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher

router = APIRouter()


class GreeksComputePayload(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    days: int = Field(..., ge=0)
    iv: float = Field(..., ge=0)
    type: str = Field(default="CE")


@router.get("/fno/greeks/{symbol}")
async def get_chain_greeks(
    symbol: str,
    expiry: str | None = Query(default=None),
    range: int = Query(default=20, ge=5, le=100),
) -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    engine = get_greeks_engine()
    chain = await fetcher.get_option_chain(symbol, expiry=expiry, strike_range=range)
    out = engine.compute_chain_greeks(chain)
    return {
        "symbol": out.get("symbol"),
        "expiry_date": out.get("expiry_date"),
        "spot_price": out.get("spot_price"),
        "atm_strike": out.get("atm_strike"),
        "strikes": out.get("strikes", []),
    }


@router.post("/fno/greeks/compute")
async def compute_greeks(payload: GreeksComputePayload) -> dict[str, Any]:
    engine = get_greeks_engine()
    greeks = engine.compute_greeks(
        payload.spot,
        payload.strike,
        payload.days,
        payload.iv,
        payload.type,
    )
    return {"inputs": payload.model_dump(), "greeks": greeks}
