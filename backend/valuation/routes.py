from __future__ import annotations

# OWNER: agent F
from fastapi import APIRouter, Query

from backend.api.deps import fetch_stock_snapshot_coalesced, get_unified_fetcher
from backend.valuation.reverse_dcf import build_reverse_dcf

router = APIRouter(prefix="/api/valuation", tags=["valuation"])


@router.get("/{symbol}/reverse-dcf")
async def reverse_dcf(
    symbol: str,
    discount_rate: float = Query(0.12, gt=0, lt=0.5, description="Discount rate as a fraction, e.g. 0.12"),
    terminal_growth: float = Query(0.03, ge=0, lt=0.5, description="Terminal growth as a fraction, e.g. 0.03"),
    years: int = Query(10, ge=3, le=20, description="Forecast horizon in years"),
    basis: str = Query("fcf", pattern="^(fcf|net_income)$", description="Cash-flow basis"),
) -> dict:
    """Reverse-DCF: back out the growth rate implied by today's price."""
    snapshot = await fetch_stock_snapshot_coalesced(symbol)
    fetcher = await get_unified_fetcher()
    financials = await fetcher.fetch_10yr_financials(symbol)

    return build_reverse_dcf(
        symbol,
        price=snapshot.get("current_price"),
        market_cap=snapshot.get("market_cap"),
        currency=snapshot.get("currency"),
        financials=financials,
        discount_rate=discount_rate,
        terminal_growth=terminal_growth,
        years=years,
        basis=basis,
    )