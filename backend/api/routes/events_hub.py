from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from backend.services.events_hub import ALLOWED_TYPES, get_upcoming_events

router = APIRouter()


@router.get("/events-hub/upcoming")
async def get_upcoming_events_endpoint(
    symbols: str | None = None,
    days: int = Query(30, ge=1, le=365),
    types: str | None = None,
) -> dict[str, Any]:
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s and s.strip()] if symbols else []

    type_set: set[str] | None = None
    if types:
        raw_types = {t.strip().lower() for t in types.split(",") if t and t.strip()}
        # Ignore unknown type names
        type_set = {t for t in raw_types if t in ALLOWED_TYPES}

    try:
        result = await get_upcoming_events(
            symbols=symbol_list,
            days=days,
            types=type_set,
        )
        return result
    except Exception as exc:
        return {
            "as_of": None,
            "days": days,
            "symbols": symbol_list,
            "items": [],
            "errors": [{"source": "events_hub", "reason": str(exc)[:200]}],
        }