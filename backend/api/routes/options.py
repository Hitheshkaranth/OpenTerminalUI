"""Option chain and options analytics endpoints."""
from __future__ import annotations

from dataclasses import asdict
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query

from backend.adapters.registry import get_adapter_registry
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher

router = APIRouter(prefix="/api/options", tags=["options"])


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
        except Exception as e:
            raise HTTPException(500, f"Error fetching mock option chain: {str(e)}")

    fetcher = get_option_chain_fetcher()
    try:
        result = await fetcher.get_option_chain(underlying.upper(), expiry=expiry, strike_range=range)
        if not result.get("strikes"):
             raise HTTPException(404, f"No option chain found for {underlying}")
        return result
    except Exception as e:
        raise HTTPException(500, f"Error fetching option chain: {str(e)}")


@router.get("/expirations/{underlying}")
async def get_available_expiries(underlying: str):
    """List available option expiry dates for an underlying (auto-detects US/NSE)."""
    fetcher = get_option_chain_fetcher()
    try:
        items = await fetcher.get_expiry_dates(underlying.upper())
        return {"underlying": underlying.upper(), "expiries": items}
    except Exception as e:
        raise HTTPException(500, f"Error fetching expiries: {str(e)}")
