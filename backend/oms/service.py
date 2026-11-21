from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from backend.models import AuditLogORM, OmsFillORM, OmsOrderORM, OpsKillSwitchORM, RestrictedListORM


def log_audit(
    db: Session,
    event_type: str,
    entity_type: str,
    entity_id: str | None,
    payload: dict[str, Any],
    user_id: str | None = None,
    *,
    commit: bool = True,
) -> None:
    """Record an audit row.

    ``commit=False`` only flushes so the caller can commit the audit row in the same
    transaction as the change it describes (the OMS, ops and governance routes do this).
    The default keeps committing for standalone audit events.
    """
    db.add(
        AuditLogORM(
            user_id=user_id,
            event_type=event_type,
            entity_type=entity_type,
            entity_id=entity_id,
            payload_json=payload,
            created_at=datetime.now(timezone.utc),
        )
    )
    if commit:
        db.commit()
    else:
        db.flush()


def is_kill_switch_enabled(db: Session, scope: str = "orders") -> bool:
    row = db.query(OpsKillSwitchORM).filter(OpsKillSwitchORM.scope == scope).first()
    return bool(row.enabled) if row else False


def pre_trade_checks(db: Session, symbol: str, quantity: float, price: float, adv: float, max_position_notional: float, max_adv_pct: float) -> tuple[bool, str | None]:
    if is_kill_switch_enabled(db, scope="orders"):
        return False, "Kill switch enabled"
    restricted = db.query(RestrictedListORM).filter(RestrictedListORM.symbol == symbol.upper(), RestrictedListORM.active.is_(True)).first()
    if restricted:
        return False, f"Restricted symbol: {restricted.reason or 'compliance restriction'}"
    notional = abs(quantity * price)
    if notional > max_position_notional:
        return False, f"Max position exceeded: {notional:.2f} > {max_position_notional:.2f}"
    if adv > 0 and notional > adv * max_adv_pct:
        return False, f"ADV participation exceeded: {notional:.2f} > {adv * max_adv_pct:.2f}"
    return True, None


def create_order(
    db: Session,
    user_id: str | None,
    symbol: str,
    side: str,
    quantity: float,
    order_type: str,
    limit_price: float | None,
    meta_json: dict[str, Any],
    accepted: bool,
    rejection_reason: str | None = None,
) -> OmsOrderORM:
    """Stage an order (flush only; the caller commits)."""
    row = OmsOrderORM(
        user_id=user_id,
        symbol=symbol.upper(),
        side=side.lower(),
        quantity=float(quantity),
        order_type=order_type.lower(),
        limit_price=limit_price,
        status="accepted" if accepted else "rejected",
        rejection_reason=rejection_reason,
        meta_json=meta_json,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.flush()
    log_audit(
        db,
        event_type="oms_order_created",
        entity_type="order",
        entity_id=row.id,
        payload={"status": row.status, "symbol": row.symbol, "side": row.side, "quantity": row.quantity, "rejection_reason": row.rejection_reason},
        user_id=user_id,
        commit=False,
    )
    return row


def create_fill(db: Session, order_id: str, symbol: str, quantity: float, fill_price: float, cost: float) -> OmsFillORM:
    """Stage a fill (flush only; the caller commits)."""
    row = OmsFillORM(
        order_id=order_id,
        symbol=symbol.upper(),
        quantity=float(quantity),
        fill_price=float(fill_price),
        cost=float(cost),
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.flush()
    log_audit(
        db,
        event_type="oms_fill_created",
        entity_type="fill",
        entity_id=row.id,
        payload={"order_id": order_id, "symbol": symbol, "quantity": quantity, "fill_price": fill_price, "cost": cost},
        commit=False,
    )
    return row
