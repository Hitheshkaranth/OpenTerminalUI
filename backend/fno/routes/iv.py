from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from backend.fno.services.iv_engine import get_iv_engine

router = APIRouter()


@router.get("/fno/iv/{symbol}")
async def iv_data(symbol: str, expiry: str | None = Query(default=None)) -> dict[str, Any]:
    engine = get_iv_engine()
    return await engine.get_iv_data(symbol, expiry=expiry)


@router.get("/fno/iv/{symbol}/surface")
async def iv_surface(symbol: str) -> dict[str, Any]:
    engine = get_iv_engine()
    return await engine.get_iv_surface(symbol)
