from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, date, timezone

from backend.core.api_key_auth import get_api_key_user
from backend.core.rate_limiter import api_key_rate_limiter
from backend.api.deps import get_unified_fetcher
from backend.shared.db import SessionLocal

router = APIRouter(
    dependencies=[Depends(get_api_key_user), Depends(api_key_rate_limiter)]
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("/v1/quote/{symbol}")
async def get_public_quote(symbol: str):
    fetcher = await get_unified_fetcher()
    quote = await fetcher.fetch_quote(symbol)
    return {
        "data": quote,
        "meta": {"timestamp": datetime.now(timezone.utc).isoformat(), "source": "openterminalui"}
    }

@router.get("/v1/ohlcv/{symbol}")
async def get_public_ohlcv(
    symbol: str, 
    interval: str = "1d", 
    start: Optional[date] = None, 
    end: Optional[date] = None
):
    fetcher = await get_unified_fetcher()
    history = await fetcher.fetch_history(symbol, period="1y" if not start else None)
    return {
        "data": history,
        "meta": {"timestamp": datetime.now(timezone.utc).isoformat(), "source": "openterminalui"}
    }

@router.get("/v1/fundamentals/{symbol}")
async def get_public_fundamentals(symbol: str):
    fetcher = await get_unified_fetcher()
    snapshot = await fetcher.fetch_stock_snapshot(symbol)
    return {
        "data": snapshot,
        "meta": {"timestamp": datetime.now(timezone.utc).isoformat(), "source": "openterminalui"}
    }

@router.get("/v1/watchlist/{watchlist_id}")
async def get_public_watchlist(watchlist_id: int, db: Session = Depends(get_db)):
    return {
        "data": {"id": watchlist_id, "name": "Sample Watchlist", "symbols": ["RELIANCE", "TCS"]},
        "meta": {"timestamp": datetime.now(timezone.utc).isoformat(), "source": "openterminalui"}
    }

@router.get("/v1/portfolio")
async def get_public_portfolio(db: Session = Depends(get_db)):
    return {
        "data": {"holdings": [], "total_value": 0, "total_pnl": 0},
        "meta": {"timestamp": datetime.now(timezone.utc).isoformat(), "source": "openterminalui"}
    }
