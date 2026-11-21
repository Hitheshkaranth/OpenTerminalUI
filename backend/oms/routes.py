from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import fetch_stock_snapshot_coalesced, get_db
from backend.auth.deps import get_current_user, require_role
from backend.config.constants import DEFAULT_MAX_ADV_PCT, DEFAULT_MAX_POSITION_NOTIONAL
from backend.models import OmsOrderORM, RestrictedListORM, User
from backend.models.api_response import ApiResponse
from backend.oms.service import create_fill, create_order, log_audit, pre_trade_checks
from backend.shared.transaction_costs import TransactionCostModel

logger = logging.getLogger(__name__)

router = APIRouter()

_COST_MODEL = TransactionCostModel()


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, "") or default)
    except (TypeError, ValueError):
        return float(default)
    return value if value > 0 else float(default)


def _server_limits() -> tuple[float, float]:
    """Pre-trade limits are server policy; client-sent values are ignored (SEC-9)."""
    max_notional = _env_float("OMS_MAX_POSITION_NOTIONAL", DEFAULT_MAX_POSITION_NOTIONAL)
    max_adv_pct = min(_env_float("OMS_MAX_ADV_PCT", DEFAULT_MAX_ADV_PCT), 1.0)
    return max_notional, max_adv_pct


def _cost_side(side: str) -> str:
    return "BUY" if side.lower() in {"buy", "long"} else "SELL"


def _limit_crossed(side: str, market_price: float, limit_price: float) -> bool:
    if _cost_side(side) == "BUY":
        return market_price <= limit_price
    return market_price >= limit_price


class OmsOrderRequest(BaseModel):
    symbol: str
    side: str = Field(pattern="^(buy|sell|long|short)$")
    quantity: float = Field(gt=0)
    order_type: str = "market"
    limit_price: float | None = Field(default=None, gt=0)
    # Accepted for backward compatibility only; the server enforces its own policy
    # limits (OMS_MAX_POSITION_NOTIONAL / OMS_MAX_ADV_PCT) and ignores these.
    max_position_notional: float | None = None
    max_adv_pct: float | None = None
    simulate_fill: bool = True


class RestrictedRequest(BaseModel):
    symbol: str
    reason: str = ""
    active: bool = True


def _persist_order(
    db: Session,
    user_id: str,
    payload: OmsOrderRequest,
    symbol: str,
    price: float,
    adv: float,
) -> dict[str, Any]:
    max_notional, max_adv_pct = _server_limits()
    order_type = payload.order_type.lower()
    try:
        ok, reason = pre_trade_checks(
            db=db,
            symbol=symbol,
            quantity=payload.quantity,
            price=price,
            adv=adv,
            max_position_notional=max_notional,
            max_adv_pct=max_adv_pct,
        )
        order = create_order(
            db=db,
            user_id=user_id,
            symbol=symbol,
            side=payload.side,
            quantity=payload.quantity,
            order_type=order_type,
            limit_price=payload.limit_price,
            meta_json={"adv_proxy": adv, "market_price": price},
            accepted=ok,
            rejection_reason=reason,
        )
        fill_payload: dict[str, Any] | None = None
        should_fill = ok and payload.simulate_fill
        if should_fill and order_type == "limit":
            # Limit orders fill only when the market is through the limit; otherwise
            # they stay accepted/open.
            should_fill = _limit_crossed(payload.side, price, float(payload.limit_price or 0.0))
        if should_fill:
            notional = abs(payload.quantity * price)
            cost = _COST_MODEL.calculate_leg_cost(notional, _cost_side(payload.side)).total
            fill = create_fill(
                db=db,
                order_id=order.id,
                symbol=symbol,
                quantity=payload.quantity,
                fill_price=price,
                cost=cost,
            )
            order.status = "filled"
            order.updated_at = datetime.now(timezone.utc)
            log_audit(
                db=db,
                event_type="oms_order_filled",
                entity_type="order",
                entity_id=order.id,
                payload={"symbol": symbol, "price": price, "quantity": payload.quantity, "cost": cost},
                user_id=user_id,
                commit=False,
            )
            fill_payload = {
                "id": fill.id,
                "fill_price": fill.fill_price,
                "quantity": fill.quantity,
                "cost": fill.cost,
            }
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("OMS order persistence failed for %s", symbol)
        raise HTTPException(status_code=500, detail="Failed to record order") from None
    return {
        "order": {
            "id": order.id,
            "symbol": order.symbol,
            "side": order.side,
            "quantity": order.quantity,
            "order_type": order.order_type,
            "limit_price": order.limit_price,
            "status": order.status,
            "rejection_reason": order.rejection_reason,
            "created_at": order.created_at.isoformat(),
        },
        "fill": fill_payload,
    }


@router.post("/oms/order")
async def oms_order(
    payload: OmsOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    symbol = payload.symbol.strip().upper()
    if payload.order_type.lower() not in {"market", "limit"}:
        raise HTTPException(status_code=422, detail="order_type must be 'market' or 'limit'")
    if payload.order_type.lower() == "limit" and not payload.limit_price:
        raise HTTPException(status_code=422, detail="limit_price is required for limit orders")
    snap = await fetch_stock_snapshot_coalesced(symbol)
    try:
        price = float((snap or {}).get("current_price") or 0.0)
    except (TypeError, ValueError):
        price = 0.0
    if price <= 0:
        # Never fill at a client-supplied price when no market price is available.
        raise HTTPException(status_code=503, detail="Market price unavailable; order not accepted")
    try:
        market_cap = float((snap or {}).get("market_cap") or 0.0)
    except (TypeError, ValueError):
        market_cap = 0.0
    adv = market_cap / max(price, 1e-6) * 0.005  # rough ADV proxy
    # Sync Session work runs off the event loop (SCALE-10).
    return await asyncio.to_thread(_persist_order, db, current_user.id, payload, symbol, price, adv)


@router.get("/oms/orders")
def oms_orders(
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    query = db.query(OmsOrderORM).filter((OmsOrderORM.user_id == current_user.id) | (OmsOrderORM.user_id.is_(None)))
    if status:
        query = query.filter(OmsOrderORM.status == status)
    rows = query.order_by(OmsOrderORM.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "items": [
            {
                "id": row.id,
                "symbol": row.symbol,
                "side": row.side,
                "quantity": row.quantity,
                "order_type": row.order_type,
                "limit_price": row.limit_price,
                "status": row.status,
                "rejection_reason": row.rejection_reason,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ]
    }


@router.post("/oms/restricted")
def oms_restricted(
    payload: RestrictedRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> dict[str, Any]:
    symbol = payload.symbol.strip().upper()
    try:
        row = db.query(RestrictedListORM).filter(RestrictedListORM.symbol == symbol).first()
        if row is None:
            row = RestrictedListORM(symbol=symbol, reason=payload.reason, active=payload.active, created_at=datetime.now(timezone.utc))
            db.add(row)
        else:
            row.reason = payload.reason
            row.active = payload.active
        db.flush()
        log_audit(
            db=db,
            event_type="oms_restricted_updated",
            entity_type="restricted_list",
            entity_id=row.id,
            payload={"symbol": symbol, "active": payload.active, "reason": payload.reason},
            user_id=current_user.id,
            commit=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("OMS restricted-list update failed for %s", symbol)
        raise HTTPException(status_code=500, detail="Failed to update restricted list") from None
    return {"id": row.id, "symbol": row.symbol, "active": row.active, "reason": row.reason}
