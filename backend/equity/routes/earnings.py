from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.equity.services.earnings import earnings_service

router = APIRouter(prefix="/api/earnings", tags=["earnings"])


def _parse_date(raw: Optional[str], field: str) -> Optional[date]:
    if not raw:
        return None
    text = raw.strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: {raw}") from exc


@router.get("/calendar")
async def get_earnings_calendar(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    symbols: Optional[str] = None,
) -> dict[str, object]:
    from_dt = _parse_date(from_date, "from_date")
    to_dt = _parse_date(to_date, "to_date")
    symbol_list = [x.strip().upper() for x in (symbols or "").split(",") if x.strip()]
    rows = await earnings_service.get_earnings_calendar(from_date=from_dt, to_date=to_dt, symbols=symbol_list or None)
    return {"count": len(rows), "items": [x.model_dump() for x in rows]}


@router.get("/portfolio")
async def get_portfolio_earnings(symbols: str = Query(...), days: int = 30) -> dict[str, object]:
    parsed = [x.strip().upper() for x in (symbols or "").split(",") if x.strip()]
    if not parsed:
        raise HTTPException(status_code=400, detail="Provide symbols as comma-separated values")
    rows = await earnings_service.get_portfolio_earnings(parsed, days_ahead=max(1, days))
    return {"count": len(rows), "items": [x.model_dump() for x in rows]}


@router.get("/{symbol}/next")
async def get_next_earnings(symbol: str) -> dict[str, object]:
    row = await earnings_service.get_next_earnings(symbol)
    return {"item": row.model_dump() if row else None}


@router.get("/{symbol}/financials")
async def get_quarterly_financials(symbol: str, quarters: int = 12) -> dict[str, object]:
    rows = await earnings_service.get_quarterly_financials(symbol, quarters=max(1, min(quarters, 24)))
    return {"count": len(rows), "items": [x.model_dump() for x in rows]}


@router.get("/{symbol}/analysis")
async def get_earnings_analysis(symbol: str) -> dict[str, object]:
    out = await earnings_service.get_earnings_analysis(symbol)
    return out.model_dump()
