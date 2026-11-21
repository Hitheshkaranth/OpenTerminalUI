"""Option chain and options analytics endpoints."""
from __future__ import annotations

import logging

from dataclasses import asdict
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.adapters.registry import get_adapter_registry
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher

router = APIRouter(prefix="/api/options", tags=["options"])
logger = logging.getLogger(__name__)


class GreeksRequest(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    time_to_expiry: float = Field(..., gt=0, description="Years")
    rate: float = 0.05
    volatility: float = Field(..., gt=0)
    dividend_yield: float = 0.0
    option_type: str = "call"


class ImpliedVolRequest(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    time_to_expiry: float = Field(..., gt=0)
    rate: float = 0.05
    dividend_yield: float = 0.0
    option_type: str = "call"
    market_price: float = Field(..., gt=0)


@router.post("/greeks")
async def option_greeks(req: GreeksRequest):
    """Black-Scholes price + Greeks for a European option."""
    from backend.core.option_greeks import OptionSpec, greeks
    try:
        spec = OptionSpec(spot=req.spot, strike=req.strike, time_to_expiry=req.time_to_expiry,
                          rate=req.rate, volatility=req.volatility,
                          dividend_yield=req.dividend_yield, option_type=req.option_type)
        return greeks(spec)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/implied-vol")
async def option_implied_vol(req: ImpliedVolRequest):
    """Solve Black-Scholes implied volatility from a market price."""
    from backend.core.option_greeks import OptionSpec, implied_volatility
    try:
        spec = OptionSpec(spot=req.spot, strike=req.strike, time_to_expiry=req.time_to_expiry,
                          rate=req.rate, volatility=0.2,
                          dividend_yield=req.dividend_yield, option_type=req.option_type)
        iv = implied_volatility(spec, req.market_price)
        return {"implied_volatility": round(iv, 6)}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/chain/{underlying}")
async def get_option_chain(
    underlying: str,
    expiry: str | None = Query(None, description="ISO date, e.g. 2026-02-27"),
    provider: str | None = Query(None, description="Provider override: mock, kite, etc."),
    range: int = Query(20, description="Number of strikes to show"),
):
    """Fetch option chain for underlying + expiry (auto-detects US/NSE)."""
    if provider == "mock":
        try:
            registry = get_adapter_registry()
            adapter = registry._instance("mock")  # noqa: SLF001
            expiry_date = date.fromisoformat(expiry) if expiry else date.today() + timedelta(days=7)
            chain = await adapter.get_option_chain(underlying.upper(), expiry_date)
            return {
                "underlying": chain.underlying,
                "spot_price": chain.spot_price,
                "expiry": chain.expiry,
                "contracts": [asdict(c) for c in chain.contracts],
                "pcr_oi": chain.pcr_oi,
                "pcr_volume": chain.pcr_volume,
                "max_pain": chain.max_pain,
                "timestamp": chain.timestamp,
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("Error fetching mock option chain")
            raise HTTPException(500, "Error fetching mock option chain") from e

    fetcher = get_option_chain_fetcher()
    try:
        result = await fetcher.get_option_chain(underlying.upper(), expiry=expiry, strike_range=range)
        if not result.get("strikes"):
             raise HTTPException(404, f"No option chain found for {underlying}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error fetching option chain")
        raise HTTPException(500, "Error fetching option chain") from e


@router.get("/expirations/{underlying}")
async def get_available_expiries(underlying: str):
    """List available option expiry dates for an underlying (auto-detects US/NSE)."""
    fetcher = get_option_chain_fetcher()
    try:
        items = await fetcher.get_expiry_dates(underlying.upper())
        return {"underlying": underlying.upper(), "expiries": items}
    except Exception as e:
        logger.exception("Error fetching expiries")
        raise HTTPException(500, "Error fetching expiries") from e
