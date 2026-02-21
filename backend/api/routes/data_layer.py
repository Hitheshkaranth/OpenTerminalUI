from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_unified_fetcher
from backend.auth.deps import get_current_user
from backend.models import User
from backend.services.data_version_service import create_data_version, get_active_data_version
from backend.services.pit_fundamentals_service import get_fundamentals_asof, get_universe_members
from backend.services.price_series_service import get_price_series

router = APIRouter()


class DataVersionCreateRequest(BaseModel):
    name: str
    description: str = ""
    source: str = "internal"
    activate: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.get("/data/version/active")
def data_version_active(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = get_active_data_version(db)
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "source": row.source,
        "is_active": row.is_active,
        "created_at": row.created_at.isoformat(),
        "metadata": row.metadata_json if isinstance(row.metadata_json, dict) else {},
    }


@router.post("/data/version")
def data_version_create(
    payload: DataVersionCreateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = create_data_version(
        db=db,
        name=payload.name,
        description=payload.description,
        source=payload.source,
        activate=payload.activate,
        metadata=payload.metadata,
    )
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "source": row.source,
        "is_active": row.is_active,
        "created_at": row.created_at.isoformat(),
        "metadata": row.metadata_json if isinstance(row.metadata_json, dict) else {},
    }


@router.get("/prices/{symbol}")
async def get_prices(
    symbol: str,
    adjusted: bool = Query(default=True),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    data_version_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    fetcher: Any = Depends(get_unified_fetcher),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    resolved_version_id, points = await get_price_series(
        db=db,
        fetcher=fetcher,
        symbol=symbol.upper(),
        adjusted=adjusted,
        start=start,
        end=end,
        data_version_id=data_version_id,
    )
    return {
        "symbol": symbol.upper(),
        "adjusted": adjusted,
        "data_version_id": resolved_version_id,
        "count": len(points),
        "items": [
            {"date": p.date, "open": p.open, "high": p.high, "low": p.low, "close": p.close, "volume": p.volume}
            for p in points
        ],
    }


@router.get("/fundamentals/{symbol}")
def get_fundamentals(
    symbol: str,
    as_of: str = Query(default_factory=lambda: datetime.utcnow().strftime("%Y-%m-%d")),
    data_version_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    resolved_version_id, metrics = get_fundamentals_asof(db, symbol.upper(), as_of=as_of, data_version_id=data_version_id)
    return {
        "symbol": symbol.upper(),
        "as_of": as_of,
        "data_version_id": resolved_version_id,
        "metrics": metrics,
    }


@router.get("/universe/{universe_id}")
def get_universe(
    universe_id: str,
    as_of: str | None = Query(default=None),
    data_version_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    resolved_version_id, members = get_universe_members(db, universe_id=universe_id, as_of=as_of, data_version_id=data_version_id)
    return {
        "universe_id": universe_id,
        "as_of": as_of,
        "data_version_id": resolved_version_id,
        "count": len(members),
        "members": members,
    }
