from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import OpsKillSwitchORM, User
from backend.oms.service import log_audit
from backend.services.marketdata_hub import get_marketdata_hub

router = APIRouter()


class KillSwitchRequest(BaseModel):
    scope: str = Field(default="orders")
    enabled: bool
    reason: str = ""


@router.get("/ops/feed-health")
async def feed_health(_: User = Depends(get_current_user)) -> dict[str, Any]:
    hub = get_marketdata_hub()
    snap = await hub.metrics_snapshot()
    ws_clients = int(snap.get("ws_connected_clients", 0))
    ws_subs = int(snap.get("ws_subscriptions", 0))
    freshness_state = "ok" if ws_clients >= 0 else "unknown"
    return {
        "feed_state": freshness_state,
        "ws_connected_clients": ws_clients,
        "ws_subscriptions": ws_subs,
        "kite_stream_status": hub.kite_stream_status(),
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/ops/kill-switch")
def get_kill_switches(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    rows = db.query(OpsKillSwitchORM).order_by(OpsKillSwitchORM.scope.asc()).all()
    return {
        "items": [
            {
                "id": row.id,
                "scope": row.scope,
                "enabled": row.enabled,
                "reason": row.reason,
                "updated_at": row.updated_at.isoformat(),
            }
            for row in rows
        ]
    }


@router.post("/ops/kill-switch")
def set_kill_switch(
    payload: KillSwitchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = db.query(OpsKillSwitchORM).filter(OpsKillSwitchORM.scope == payload.scope).first()
    if row is None:
        row = OpsKillSwitchORM(scope=payload.scope, enabled=payload.enabled, reason=payload.reason, updated_at=datetime.utcnow())
        db.add(row)
    else:
        row.enabled = payload.enabled
        row.reason = payload.reason
        row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    log_audit(
        db=db,
        event_type="ops_kill_switch_updated",
        entity_type="kill_switch",
        entity_id=row.id,
        payload={"scope": row.scope, "enabled": row.enabled, "reason": row.reason},
        user_id=current_user.id,
    )
    return {
        "id": row.id,
        "scope": row.scope,
        "enabled": row.enabled,
        "reason": row.reason,
        "updated_at": row.updated_at.isoformat(),
    }
