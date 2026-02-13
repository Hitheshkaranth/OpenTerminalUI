from __future__ import annotations

import asyncio

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.api.deps import fetch_stock_snapshot_coalesced, get_db
from backend.db.models import Holding, WatchlistItem

router = APIRouter()


class HoldingCreate(BaseModel):
    ticker: str
    quantity: float = Field(gt=0)
    avg_buy_price: float = Field(gt=0)
    buy_date: str


class WatchlistCreate(BaseModel):
    watchlist_name: str
    ticker: str


@router.get("/portfolio")
async def get_portfolio(db: Session = Depends(get_db)) -> dict[str, object]:
    holdings = db.query(Holding).all()
    sem = asyncio.Semaphore(16)

    async def _price_for(ticker: str) -> float | None:
        async with sem:
            try:
                snap = await fetch_stock_snapshot_coalesced(ticker)
                price = snap.get("current_price")
                return float(price) if isinstance(price, (int, float)) else None
            except Exception:
                return None

    price_tasks = {h.id: asyncio.create_task(_price_for(h.ticker)) for h in holdings}
    rows: list[dict[str, object]] = []
    total_cost = 0.0
    total_value = 0.0
    for h in holdings:
        total_cost += float(h.quantity) * float(h.avg_buy_price)
        price = await price_tasks[h.id]
        current_value = float(h.quantity) * float(price) if isinstance(price, (int, float)) else None
        if current_value is not None:
            total_value += current_value
        rows.append(
            {
                "id": h.id,
                "ticker": h.ticker,
                "quantity": h.quantity,
                "avg_buy_price": h.avg_buy_price,
                "buy_date": h.buy_date,
                "current_price": price,
                "current_value": current_value,
                "pnl": (current_value - (float(h.quantity) * float(h.avg_buy_price))) if current_value is not None else None,
            }
        )

    overall_pnl = total_value - total_cost if total_value > 0 else None
    return {
        "items": rows,
        "summary": {
            "total_cost": total_cost,
            "total_value": total_value if total_value > 0 else None,
            "overall_pnl": overall_pnl,
        },
    }


@router.post("/portfolio/holdings")
def add_holding(payload: HoldingCreate, db: Session = Depends(get_db)) -> dict[str, object]:
    row = Holding(
        ticker=payload.ticker.strip().upper(),
        quantity=float(payload.quantity),
        avg_buy_price=float(payload.avg_buy_price),
        buy_date=payload.buy_date,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"status": "created", "holding": {"id": row.id, "ticker": row.ticker}}


@router.delete("/portfolio/holdings/{holding_id}")
def delete_holding(holding_id: int, db: Session = Depends(get_db)) -> dict[str, object]:
    row = db.query(Holding).filter(Holding.id == holding_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": holding_id}


@router.get("/watchlists")
def get_watchlists(db: Session = Depends(get_db)) -> dict[str, list[dict[str, object]]]:
    items = db.query(WatchlistItem).all()
    return {
        "items": [
            {"id": x.id, "watchlist_name": x.watchlist_name, "ticker": x.ticker}
            for x in items
        ]
    }


@router.post("/watchlists/items")
def add_watchlist_item(payload: WatchlistCreate, db: Session = Depends(get_db)) -> dict[str, object]:
    row = WatchlistItem(watchlist_name=payload.watchlist_name.strip(), ticker=payload.ticker.strip().upper())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"status": "created", "item": {"id": row.id, "watchlist_name": row.watchlist_name, "ticker": row.ticker}}


@router.delete("/watchlists/items/{item_id}")
def delete_watchlist_item(item_id: int, db: Session = Depends(get_db)) -> dict[str, object]:
    row = db.query(WatchlistItem).filter(WatchlistItem.id == item_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": item_id}
