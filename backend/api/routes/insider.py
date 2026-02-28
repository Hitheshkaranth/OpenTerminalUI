from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Any, Dict, List

from backend.api.deps import get_db
from backend.services.insider_monitor import fetch_insider_trading, fetch_insider_clusters

router = APIRouter(prefix="/api/insider-trading", tags=["insider-trading"])

@router.get("/clusters", response_model=List[Dict[str, Any]])
async def get_insider_clusters(db: Session = Depends(get_db)):
    return await fetch_insider_clusters(db)

@router.get("/{symbol}", response_model=List[Dict[str, Any]])
async def get_insider_trades(symbol: str, db: Session = Depends(get_db)):
    return await fetch_insider_trading(symbol, db)
