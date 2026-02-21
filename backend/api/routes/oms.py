from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import fetch_stock_snapshot_coalesced, get_db
from backend.auth.deps import get_current_user
from backend.models import OmsOrderORM, RestrictedListORM, User
from backend.oms.service import create_fill, create_order, log_audit, pre_trade_checks

router = APIRouter()


class OmsOrderRequest(BaseModel):
    symbol: str
    side: str = Field(pattern="^(buy|sell|long|short)$")
    quantity: float = Field(gt=0)
    order_type: str = "market"
    limit_price: float | None = None
    max_position_notional: float = 5_000_000
    max_adv_pct: float = 0.1
    simulate_fill: bool = True


class RestrictedRequest(BaseModel):
    symbol: str
    reason: str = ""
    active: bool = True


@router.post("/oms/order")
async def oms_order(
    payload: OmsOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    symbol = payload.symbol.strip().upper()
    snap = await fetch_stock_snapshot_coalesced(symbol)
    price = float(snap.get("current_price") or payload.limit_price or 0.0)
    if price <= 0:
        raise HTTPException(status_code=400, detail="Unable to resolve valid symbol price")
    adv = float(snap.get("market_cap") or 0.0) / max(price, 1e-6) * 0.005  # rough ADV proxy
    ok, reason = pre_trade_checks(
        db=db,
        symbol=symbol,
        quantity=payload.quantity,
        price=price,
        adv=adv,
        max_position_notional=payload.max_position_notional,
        max_adv_pct=payload.max_adv_pct,
    )
    order = create_order(
        db=db,
        user_id=current_user.id,
        symbol=symbol,
        side=payload.side,
        quantity=payload.quantity,
        order_type=payload.order_type,
        limit_price=payload.limit_price,
        meta_json={"adv_proxy": adv, "market_price": price},
        accepted=ok,
        rejection_reason=reason,
    )
    fill_payload: dict[str, Any] | None = None
    if ok and payload.simulate_fill:
        fill = create_fill(
            db=db,
            order_id=order.id,
            symbol=symbol,
            quantity=payload.quantity,
            fill_price=price,
            cost=0.0,
        )
        order.status = "filled"
        order.updated_at = datetime.utcnow()
        db.commit()
        fill_payload = {
            "id": fill.id,
            "fill_price": fill.fill_price,
            "quantity": fill.quantity,
            "cost": fill.cost,
        }
        log_audit(
            db=db,
            event_type="oms_order_filled",
            entity_type="order",
            entity_id=order.id,
            payload={"symbol": symbol, "price": price, "quantity": payload.quantity},
            user_id=current_user.id,
        )
    return {
        "order": {
            "id": order.id,
            "symbol": order.symbol,
            "side": order.side,
            "quantity": order.quantity,
            "status": order.status,
            "rejection_reason": order.rejection_reason,
            "created_at": order.created_at.isoformat(),
        },
        "fill": fill_payload,
    }


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
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    symbol = payload.symbol.strip().upper()
    row = db.query(RestrictedListORM).filter(RestrictedListORM.symbol == symbol).first()
    if row is None:
        row = RestrictedListORM(symbol=symbol, reason=payload.reason, active=payload.active, created_at=datetime.utcnow())
        db.add(row)
    else:
        row.reason = payload.reason
        row.active = payload.active
    db.commit()
    log_audit(
        db=db,
        event_type="oms_restricted_updated",
        entity_type="restricted_list",
        entity_id=row.id,
        payload={"symbol": symbol, "active": payload.active, "reason": payload.reason},
        user_id=current_user.id,
    )
    return {"id": row.id, "symbol": row.symbol, "active": row.active, "reason": row.reason}
