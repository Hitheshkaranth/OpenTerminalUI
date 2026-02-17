from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.equity.services.corporate_actions import EventType, corporate_actions_service

router = APIRouter(prefix="/api/events", tags=["events"])


def _parse_date(raw: Optional[str]) -> Optional[date]:
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
        raise HTTPException(status_code=400, detail=f"Invalid date format: {raw}") from exc


def _parse_event_types(raw: Optional[str]) -> Optional[list[EventType]]:
    if not raw:
        return None
    out: list[EventType] = []
    for piece in raw.split(","):
        token = piece.strip().lower()
        if not token:
            continue
        try:
            out.append(EventType(token))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Unsupported event type: {token}") from exc
    return out or None


@router.get("/portfolio/upcoming")
async def get_portfolio_events(symbols: str = Query(...), days: int = 30) -> dict[str, object]:
    parsed = [x.strip().upper() for x in (symbols or "").split(",") if x.strip()]
    if not parsed:
        raise HTTPException(status_code=400, detail="Provide symbols as comma-separated values")
    rows = await corporate_actions_service.get_portfolio_events(parsed, days_ahead=max(1, days))
    return {"count": len(rows), "items": [x.model_dump() for x in rows]}


@router.get("/{symbol}")
async def get_stock_events(
    symbol: str,
    types: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> dict[str, object]:
    parsed_types = _parse_event_types(types)
    from_dt = _parse_date(from_date)
    to_dt = _parse_date(to_date)
    rows = await corporate_actions_service.get_events(
        symbol=symbol,
        event_types=parsed_types,
        from_date=from_dt,
        to_date=to_dt,
    )
    return {"count": len(rows), "items": [x.model_dump() for x in rows]}


@router.get("/{symbol}/upcoming")
async def get_upcoming_events(symbol: str, days: int = 90) -> dict[str, object]:
    rows = await corporate_actions_service.get_upcoming_events(symbol, days_ahead=max(1, days))
    return {"count": len(rows), "items": [x.model_dump() for x in rows]}


@router.get("/{symbol}/dividends")
async def get_dividend_history(symbol: str) -> dict[str, object]:
    rows = await corporate_actions_service.get_dividend_history(symbol)
    rows.sort(key=lambda x: x.event_date, reverse=True)
    return {"count": len(rows), "items": [x.model_dump() for x in rows]}
