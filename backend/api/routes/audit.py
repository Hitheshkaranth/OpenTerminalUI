from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import AuditLogORM, User, UserRole

router = APIRouter()


@router.get("/audit")
def list_audit(
    event_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    query = db.query(AuditLogORM)
    # Non-admins see only their own events plus system (userless) ones, matching /oms/orders scoping.
    if str(getattr(current_user.role, "value", current_user.role)) != UserRole.ADMIN.value:
        query = query.filter((AuditLogORM.user_id == current_user.id) | (AuditLogORM.user_id.is_(None)))
    if event_type:
        query = query.filter(AuditLogORM.event_type == event_type)
    rows = query.order_by(AuditLogORM.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "items": [
            {
                "id": row.id,
                "user_id": row.user_id,
                "event_type": row.event_type,
                "entity_type": row.entity_type,
                "entity_id": row.entity_id,
                "payload": row.payload_json if isinstance(row.payload_json, dict) else {},
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ]
    }
