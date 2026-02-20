"""Option chain and options analytics endpoints."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query

from backend.adapters.registry import get_adapter_registry

router = APIRouter(prefix="/api/options", tags=["options"])


@router.get("/chain/{underlying}")
async def get_option_chain(
    underlying: str,
    expiry: str | None = Query(None, description="ISO date, e.g. 2026-02-27"),
    provider: str | None = Query(None, description="Force adapter: kite|mock|etc"),
):
    """Fetch option chain for underlying + expiry."""
    registry = get_adapter_registry()

    if expiry:
        try:
            exp_date = date.fromisoformat(expiry)
        except ValueError as exc:
            raise HTTPException(400, f"Invalid expiry format: {expiry}") from exc
    else:
        today = date.today()
        days_ahead = (3 - today.weekday()) % 7
        if days_ahead == 0 and today.weekday() == 3:
            days_ahead = 0
        exp_date = today + timedelta(days=days_ahead or 7)

    if provider:
        try:
            adapter = registry._instance(provider)
        except KeyError as exc:
            raise HTTPException(400, f"Unknown provider: {provider}") from exc
    else:
        chain = registry.get_chain("NFO")
        adapter = chain[0] if chain else registry.get_adapter("NFO")

    if not hasattr(adapter, "get_option_chain"):
        raise HTTPException(
            501, f"Adapter {type(adapter).__name__} does not support option chains"
        )

    result = await adapter.get_option_chain(underlying.upper(), exp_date)
    if result is None:
        raise HTTPException(404, f"No option chain found for {underlying} expiry {exp_date}")

    return {
        "underlying": result.underlying,
        "spot_price": result.spot_price,
        "expiry": result.expiry,
        "pcr_oi": result.pcr_oi,
        "pcr_volume": result.pcr_volume,
        "max_pain": result.max_pain,
        "timestamp": result.timestamp,
        "contracts": [
            {
                "symbol": c.symbol,
                "strike": c.strike,
                "option_type": c.option_type,
                "ltp": c.ltp,
                "bid": c.bid,
                "ask": c.ask,
                "iv": c.iv,
                "delta": c.delta,
                "gamma": c.gamma,
                "theta": c.theta,
                "vega": c.vega,
                "rho": c.rho,
                "oi": c.oi,
                "oi_change": c.oi_change,
                "volume": c.volume,
                "lot_size": c.lot_size,
            }
            for c in result.contracts
        ],
    }


@router.get("/expiries/{underlying}")
async def get_available_expiries(underlying: str):
    """List available option expiry dates for an underlying."""
    today = date.today()
    expiries = []

    for week in range(4):
        d = today + timedelta(weeks=week)
        days_ahead = (3 - d.weekday()) % 7
        exp = d + timedelta(days=days_ahead or 7)
        if exp > today or (exp == today):
            expiries.append({"date": exp.isoformat(), "type": "weekly"})

    for month_offset in range(1, 4):
        m = today.month + month_offset
        y = today.year + (m - 1) // 12
        m = ((m - 1) % 12) + 1
        last_day = (
            date(y, m + 1, 1) - timedelta(days=1) if m < 12 else date(y, 12, 31)
        )
        while last_day.weekday() != 3:
            last_day -= timedelta(days=1)
        expiries.append({"date": last_day.isoformat(), "type": "monthly"})

    return {"underlying": underlying.upper(), "expiries": expiries}
