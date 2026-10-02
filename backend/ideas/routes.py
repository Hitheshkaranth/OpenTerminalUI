from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.ideas import service

router = APIRouter(prefix="/api/ideas", tags=["ideas"])


@router.get("")
async def ideas_board(market: str = Query("IN"), db: Session = Depends(get_db)) -> dict[str, Any]:
    return await service.get_ideas_board(db, market)


@router.get("/timeline")
async def ideas_timeline(
    symbols: str = Query(""),
    market: str = Query("IN"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return await service.build_timeline(db, symbols, market, limit)