from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import (
    User,
    VirtualOrder,
    VirtualOrderStatus,
    VirtualPortfolio,
    VirtualPosition,
    VirtualTrade,
)
from backend.paper_trading import get_paper_engine

router = APIRouter()


class PortfolioCreateRequest(BaseModel):
    name: str = "Paper Portfolio"
    initial_capital: float = Field(gt=0)


class OrderCreateRequest(BaseModel):
    portfolio_id: str
    symbol: str
    side: str
    order_type: str = "market"
    quantity: float = Field(gt=0)
    limit_price: float | None = None
    sl_price: float | None = None
    slippage_bps: float = 5.0
    commission: float = 0.0


class DeployStrategyRequest(BaseModel):
    name: str = "Strategy Paper Portfolio"
    initial_capital: float = Field(default=100000.0, gt=0)
    symbol: str
    market: str = "NSE"
    strategy: str
    context: dict[str, Any] = Field(default_factory=dict)


def _portfolio_for_user(db: Session, portfolio_id: str, user_id: str) -> VirtualPortfolio:
    row = db.query(VirtualPortfolio).filter(VirtualPortfolio.id == portfolio_id, VirtualPortfolio.user_id == user_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return row


@router.post("/paper/portfolios")
def create_virtual_portfolio(
    payload: PortfolioCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = VirtualPortfolio(
        user_id=current_user.id,
        name=payload.name.strip() or "Paper Portfolio",
        initial_capital=float(payload.initial_capital),
        current_cash=float(payload.initial_capital),
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "initial_capital": row.initial_capital, "current_cash": row.current_cash}


@router.get("/paper/portfolios")
def list_virtual_portfolios(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    rows = (
        db.query(VirtualPortfolio)
        .filter(VirtualPortfolio.user_id == current_user.id)
        .order_by(VirtualPortfolio.created_at.desc())
        .all()
    )
    return {
        "items": [
            {
                "id": row.id,
                "name": row.name,
                "initial_capital": row.initial_capital,
                "current_cash": row.current_cash,
                "is_active": row.is_active,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ]
    }


@router.post("/paper/orders")
async def place_virtual_order(
    payload: OrderCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, payload.portfolio_id, current_user.id)
    side = payload.side.strip().lower()
    if side not in {"buy", "sell"}:
        raise HTTPException(status_code=400, detail="side must be buy or sell")
    order_type = payload.order_type.strip().lower()
    if order_type not in {"market", "limit", "sl"}:
        raise HTTPException(status_code=400, detail="order_type must be market/limit/sl")
    symbol = payload.symbol.strip().upper()
    if ":" not in symbol:
        symbol = f"NSE:{symbol}"
    row = VirtualOrder(
        portfolio_id=payload.portfolio_id,
        symbol=symbol,
        side=side,
        order_type=order_type,
        quantity=float(payload.quantity),
        limit_price=payload.limit_price,
        sl_price=payload.sl_price,
        status=VirtualOrderStatus.PENDING.value,
        slippage_bps=float(payload.slippage_bps),
        commission=float(payload.commission),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    await get_paper_engine().maybe_fill_market_order_now(db, row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "status": row.status,
        "symbol": row.symbol,
        "fill_price": row.fill_price,
        "fill_time": row.fill_time.isoformat() if row.fill_time else None,
    }


@router.get("/paper/portfolios/{portfolio_id}/positions")
def get_positions(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    rows = db.query(VirtualPosition).filter(VirtualPosition.portfolio_id == portfolio_id).all()
    mark_map = get_paper_engine()._mark_prices
    items = []
    for row in rows:
        mark = mark_map.get(row.symbol, row.avg_entry_price)
        unrealized = (mark - row.avg_entry_price) * row.quantity
        items.append(
            {
                "id": row.id,
                "symbol": row.symbol,
                "quantity": row.quantity,
                "avg_entry_price": row.avg_entry_price,
                "mark_price": mark,
                "unrealized_pnl": unrealized,
            }
        )
    return {"items": items}


@router.get("/paper/portfolios/{portfolio_id}/orders")
def get_orders(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    rows = (
        db.query(VirtualOrder)
        .filter(VirtualOrder.portfolio_id == portfolio_id)
        .order_by(VirtualOrder.created_at.desc())
        .all()
    )
    return {
        "items": [
            {
                "id": row.id,
                "symbol": row.symbol,
                "side": row.side,
                "order_type": row.order_type,
                "quantity": row.quantity,
                "limit_price": row.limit_price,
                "sl_price": row.sl_price,
                "status": row.status,
                "fill_price": row.fill_price,
                "fill_time": row.fill_time.isoformat() if row.fill_time else None,
                "slippage_bps": row.slippage_bps,
                "commission": row.commission,
            }
            for row in rows
        ]
    }


@router.get("/paper/portfolios/{portfolio_id}/trades")
def get_trades(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    rows = (
        db.query(VirtualTrade)
        .filter(VirtualTrade.portfolio_id == portfolio_id)
        .order_by(VirtualTrade.timestamp.desc())
        .all()
    )
    return {
        "items": [
            {
                "id": row.id,
                "order_id": row.order_id,
                "symbol": row.symbol,
                "side": row.side,
                "quantity": row.quantity,
                "price": row.price,
                "timestamp": row.timestamp.isoformat(),
                "pnl_realized": row.pnl_realized,
            }
            for row in rows
        ]
    }


@router.get("/paper/portfolios/{portfolio_id}/performance")
def get_performance(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    metrics = get_paper_engine().portfolio_performance(db, portfolio_id)
    if not metrics:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return metrics


@router.post("/paper/deploy-strategy")
def deploy_strategy(
    payload: DeployStrategyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    portfolio = VirtualPortfolio(
        user_id=current_user.id,
        name=payload.name.strip() or "Strategy Paper Portfolio",
        initial_capital=float(payload.initial_capital),
        current_cash=float(payload.initial_capital),
        is_active=True,
    )
    db.add(portfolio)
    db.flush()
    # Strategy automation hook placeholder: persist template metadata via bootstrap order marker.
    marker_order = VirtualOrder(
        portfolio_id=portfolio.id,
        symbol=f"{payload.market}:{payload.symbol.strip().upper()}",
        side="buy",
        order_type="market",
        quantity=0.0,
        status=VirtualOrderStatus.CANCELLED.value,
        signal_metadata={"strategy": payload.strategy, "context": payload.context},
    )
    db.add(marker_order)
    db.commit()
    return {"portfolio_id": portfolio.id, "status": "deployed"}
