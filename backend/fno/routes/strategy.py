from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher
from backend.fno.services.strategy_builder import get_strategy_builder

router = APIRouter()


class StrategyPayoffPayload(BaseModel):
    legs: list[dict[str, Any]] = Field(default_factory=list)
    spot_range: list[float] | None = None


class StrategyPresetPayload(BaseModel):
    preset: str
    symbol: str
    expiry: str | None = None
    strike_gap: float | None = None


@router.post("/fno/strategy/payoff")
async def strategy_payoff(payload: StrategyPayoffPayload) -> dict[str, Any]:
    builder = get_strategy_builder()
    spot_range = None
    if isinstance(payload.spot_range, list) and len(payload.spot_range) == 2:
        spot_range = (float(payload.spot_range[0]), float(payload.spot_range[1]))
    return builder.compute_payoff(payload.legs, spot_range=spot_range)


@router.get("/fno/strategy/presets")
async def strategy_presets() -> dict[str, Any]:
    builder = get_strategy_builder()
    return {"presets": builder.PRESETS}


@router.post("/fno/strategy/from-preset")
async def strategy_from_preset(payload: StrategyPresetPayload) -> dict[str, Any]:
    fetcher = get_option_chain_fetcher()
    chain = await fetcher.get_option_chain(payload.symbol, expiry=payload.expiry, strike_range=30)
    expiry = payload.expiry or str(chain.get("expiry_date") or "")
    atm = float(chain.get("atm_strike") or 0.0)
    strikes = [float(row.get("strike_price") or 0.0) for row in chain.get("strikes", []) if isinstance(row, dict)]
    strikes = [s for s in strikes if s > 0]
    strike_gap = float(payload.strike_gap or 0.0)
    if strike_gap <= 0 and len(strikes) > 1:
        strike_gap = max(1.0, strikes[1] - strikes[0])
    elif strike_gap <= 0:
        strike_gap = 50.0

    builder = get_strategy_builder()
    legs = await builder.build_from_preset(payload.preset, payload.symbol, expiry, atm, strike_gap)
    return builder.compute_payoff(legs)
