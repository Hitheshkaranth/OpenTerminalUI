from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.peer_kpis import service

router = APIRouter(prefix="/api/peer-kpis", tags=["peer-kpis"])


@router.get("/{symbol}")
async def get_peer_kpis(
    symbol: str,
    peers: str | None = Query(default=None, description="Comma-separated peers; derived from the peers service when omitted"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    symbol_list = None
    if peers is not None and str(peers).strip():
        symbol_list = [p.strip() for p in str(peers).split(",") if p.strip()]
    return await service.get_peer_kpis(db, symbol, peers=symbol_list)