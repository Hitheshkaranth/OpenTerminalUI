from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from backend.models import ScanAlertRuleORM
from backend.services.marketdata_hub import MarketDataHub


def _utcnow() -> datetime:
    return datetime.utcnow()


def _to_float(value: Any) -> float | None:
    try:
        out = float(value)
        if out != out:
            return None
        return out
    except (TypeError, ValueError):
        return None


async def process_scanner_tick(db: Session, hub: MarketDataHub, tick: dict[str, Any]) -> None:
    symbol = str(tick.get("symbol") or "").strip().upper()
    ltp = _to_float(tick.get("ltp"))
    if not symbol or ltp is None:
        return
    rows = (
        db.query(ScanAlertRuleORM)
        .filter(ScanAlertRuleORM.symbol == symbol, ScanAlertRuleORM.enabled.is_(True))
        .all()
    )
    if not rows:
        return
    now = _utcnow()
    for row in rows:
        if row.last_event_at:
            block_until = row.last_event_at + timedelta(minutes=max(1, int(row.dedupe_minutes or 15)))
            if now < block_until:
                continue
        trigger_level = float(row.trigger_level)
        invalidation = _to_float(row.invalidation_level)
        near_pct = float(row.near_trigger_pct or 0.003)
        distance = (trigger_level - ltp) / trigger_level if trigger_level else 0.0
        event_type: str | None = None
        if invalidation is not None and ltp < invalidation:
            event_type = "invalidation"
        elif ltp >= trigger_level:
            event_type = "triggered"
        elif distance <= near_pct:
            event_type = "near_trigger"
        if event_type is None:
            continue

        row.last_event_type = event_type
        row.last_event_at = now
        row.updated_at = now
        db.commit()

        payload = {
            "type": "alert_triggered",
            "source": "scanner",
            "alert_id": row.id,
            "preset_id": row.preset_id,
            "symbol": row.symbol,
            "condition": row.setup_type,
            "event_type": event_type,
            "triggered_value": ltp,
            "timestamp": now.isoformat(),
            "payload": {
                "trigger_level": trigger_level,
                "invalidation_level": invalidation,
                "distance_to_trigger": distance,
                "near_trigger_pct": near_pct,
            },
        }
        await hub.broadcast_alert(payload)
