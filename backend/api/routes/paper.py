from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
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
logger = logging.getLogger(__name__)

_LIST_LIMIT_DEFAULT = 200
_LIST_LIMIT_MAX = 1000


class PortfolioCreateRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    name: str = "Paper Portfolio"
    initial_capital: float = Field(gt=0)
    base_currency: str = "INR"


class OrderCreateRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    portfolio_id: str
    symbol: str
    side: str
    order_type: str = "market"
    quantity: float = Field(gt=0)
    limit_price: float | None = Field(default=None, gt=0)
    sl_price: float | None = Field(default=None, gt=0)
    slippage_bps: float = Field(default=5.0, ge=0, le=1000)
    commission: float = Field(default=0.0, ge=0)
    stop_price: float | None = Field(default=None, gt=0)

    @field_validator("quantity", "limit_price", "sl_price", "slippage_bps", "commission", "stop_price", mode="before")
    @classmethod
    def reject_boolean_amount(cls, value):
        if isinstance(value, bool):
            raise ValueError("Order amounts must be numeric, not boolean")
        return value


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
    from backend.paper_trading.currency import validate_currency
    try:
        validate_currency(payload.base_currency)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row = VirtualPortfolio(
        user_id=current_user.id,
        name=payload.name.strip() or "Paper Portfolio",
        base_currency=payload.base_currency,
        initial_capital=float(payload.initial_capital),
        current_cash=float(payload.initial_capital),
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "base_currency": row.base_currency, "initial_capital": row.initial_capital, "current_cash": row.current_cash}


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
                "base_currency": row.base_currency,
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
    portfolio = _portfolio_for_user(db, payload.portfolio_id, current_user.id)
    side = payload.side.strip().lower()
    if side not in {"buy", "sell"}:
        raise HTTPException(status_code=400, detail="side must be buy or sell")
    order_type = payload.order_type.strip().lower()
    if order_type not in {"market", "limit", "sl"}:
        raise HTTPException(status_code=400, detail="order_type must be market/limit/sl")
    if (order_type == "limit" and payload.limit_price is None) or (order_type == "sl" and payload.sl_price is None):
        raise HTTPException(status_code=422, detail="The selected order type requires its positive trigger price")
    symbol = payload.symbol.strip().upper()
    if not symbol or len(symbol) > 64:
        raise HTTPException(status_code=422, detail="A symbol of one to 64 characters is required")
    if ":" not in symbol:
        symbol = f"NSE:{symbol}"
    from backend.paper_trading.currency import quote_currency
    try:
        quote_currency(symbol, {}, portfolio.base_currency)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    from backend.agent.trade_preflight import build_preflight, get_risk_policy
    if get_risk_policy(db, current_user.id)["enabled"]:
        order_payload = payload.model_dump()
        order_payload.update(symbol=symbol, side=side, order_type=order_type)
        try:
            preflight = await build_preflight(db, current_user.id, order_payload)
        except ValueError as exc:
            # Curated risk-policy reasons the trader needs to see.
            db.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (TypeError, OverflowError) as exc:
            db.rollback()
            logger.exception("Paper order preflight failed for %s", symbol)
            raise HTTPException(status_code=422, detail="Order could not be risk-checked") from exc
        row.signal_metadata = {"risk_order": order_payload, "preflight": preflight, "paper_only": True}
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
        "risk_rejection": (row.signal_metadata or {}).get("risk_rejection"),
        "base_currency": db.get(VirtualPortfolio, row.portfolio_id).base_currency,
    }


@router.delete("/paper/orders/{order_id}")
def cancel_virtual_order(order_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    from sqlalchemy import update
    row = db.query(VirtualOrder).join(VirtualPortfolio).filter(
        VirtualOrder.id == order_id, VirtualPortfolio.user_id == current_user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Order not found")
    claimed = db.execute(update(VirtualOrder).where(VirtualOrder.id == order_id,
                VirtualOrder.status == "pending").values(status="cancelled")).rowcount
    if not claimed:
        raise HTTPException(status_code=409, detail="Only pending orders can be cancelled")
    db.commit()
    return {"id": order_id, "status": "cancelled"}


@router.get("/paper/portfolios/{portfolio_id}/positions")
def get_positions(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    rows = db.query(VirtualPosition).filter(VirtualPosition.portfolio_id == portfolio_id).all()
    portfolio = _portfolio_for_user(db, portfolio_id, current_user.id)
    items = []
    for row in rows:
        mark = get_paper_engine().mark_in_base(portfolio, row)
        unrealized = (mark - row.avg_entry_price) * row.quantity
        items.append(
            {
                "id": row.id,
                "symbol": row.symbol,
                "quantity": row.quantity,
                "avg_entry_price": row.avg_entry_price,
                "mark_price": mark,
                "base_currency": portfolio.base_currency,
                "unrealized_pnl": unrealized,
            }
        )
    return {"items": items}


@router.get("/paper/portfolios/{portfolio_id}/orders")
def get_orders(
    portfolio_id: str,
    limit: int = Query(default=_LIST_LIMIT_DEFAULT, ge=1, le=_LIST_LIMIT_MAX),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    portfolio = _portfolio_for_user(db, portfolio_id, current_user.id)
    rows = (
        db.query(VirtualOrder)
        .filter(VirtualOrder.portfolio_id == portfolio_id)
        .order_by(VirtualOrder.created_at.desc(), VirtualOrder.id.desc())
        .offset(offset)
        .limit(limit)
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
                "risk_rejection": (row.signal_metadata or {}).get("risk_rejection"),
                "base_currency": portfolio.base_currency,
            }
            for row in rows
        ]
    }


@router.get("/paper/portfolios/{portfolio_id}/trades")
def get_trades(
    portfolio_id: str,
    limit: int = Query(default=_LIST_LIMIT_DEFAULT, ge=1, le=_LIST_LIMIT_MAX),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    rows = (
        db.query(VirtualTrade)
        .filter(VirtualTrade.portfolio_id == portfolio_id)
        .order_by(VirtualTrade.timestamp.desc(), VirtualTrade.id.desc())
        .offset(offset)
        .limit(limit)
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
