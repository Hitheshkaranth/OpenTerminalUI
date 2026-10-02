from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.api.deps import fetch_stock_snapshot_coalesced, get_db
from backend.raw_materials import service

router = APIRouter(prefix="/api/raw-materials", tags=["raw-materials"])


async def _name_resolver(symbol: str) -> str:
    """Resolve a company display name from its live snapshot (best effort)."""
    try:
        snap = await fetch_stock_snapshot_coalesced(symbol)
        name = str((snap or {}).get("company_name") or "").strip()
        return name or symbol
    except Exception:
        return symbol


@router.get("")
async def list_commodities() -> dict[str, Any]:
    """Curated commodity catalog with best-effort live prices."""
    return {"items": await service.list_items_priced()}


@router.get("/{commodity_symbol}/companies")
async def commodity_companies(
    commodity_symbol: str,
    db: Session = Depends(get_db),
    market: str | None = Query(default=None),
) -> dict[str, Any]:
    """Listed companies linked to a commodity, merged curated + value-chain."""
    symbol = str(commodity_symbol or "").strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="commodity_symbol is required")

    companies = await service.companies_for(
        db, symbol, market=market, name_resolver=_name_resolver
    )

    entry = service.load_links().get(symbol)
    name = entry["name"] if entry else symbol
    impact_note = entry.get("impact_note", "") if entry else ""

    return {
        "commodity_symbol": symbol,
        "name": name,
        "impact_note": impact_note,
        "companies": companies,
    }