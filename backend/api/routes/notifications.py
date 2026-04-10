from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.models.notification import Notification

router = APIRouter()

NotificationType = Literal["alert", "news", "system", "trade"]
NotificationPriority = Literal["low", "medium", "high", "critical"]

VALID_TYPES = {"alert", "news", "system", "trade"}
VALID_PRIORITIES = {"low", "medium", "high", "critical"}


class NotificationCreate(BaseModel):
    type: NotificationType
    title: str
    body: str | None = None
    ticker: str | None = None
    action_url: str | None = None
    priority: NotificationPriority = "medium"


def _resolve_user_id(request: Request) -> str:
    current_user = getattr(request.state, "current_user", None)
    user_id = getattr(current_user, "id", None)
    return str(user_id or "1")


def _serialize_notification(row: Notification) -> dict[str, object]:
    created_at = row.created_at.isoformat() if isinstance(row.created_at, datetime) else str(row.created_at)
    return {
        "id": row.id,
        "type": row.type,
        "priority": row.priority,
        "title": row.title,
        "body": row.body,
        "ticker": row.ticker,
        "action_url": row.action_url,
        "read": bool(row.read),
        "created_at": created_at,
    }


def create_notification(
    db: Session,
    type: str,
    title: str,
    body: str | None = None,
    ticker: str | None = None,
    action_url: str | None = None,
    priority: str = "medium",
    user_id: str = "1",
) -> Notification:
    normalized_type = str(type or "").strip().lower()
    normalized_priority = str(priority or "medium").strip().lower()
    if normalized_type not in VALID_TYPES:
        raise ValueError(f"Invalid notification type: {type}")
    if normalized_priority not in VALID_PRIORITIES:
        raise ValueError(f"Invalid notification priority: {priority}")
    row = Notification(
        user_id=str(user_id or "1"),
        type=normalized_type,
        priority=normalized_priority,
        title=str(title or "").strip(),
        body=body,
        ticker=str(ticker or "").strip().upper() or None,
        action_url=action_url,
        read=0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("")
def list_notifications(
    request: Request,
    type: NotificationType | None = Query(default=None),
    read: bool | None = Query(default=None),
    priority: NotificationPriority | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    query = db.query(Notification).filter(Notification.user_id == _resolve_user_id(request))
    if type is not None:
        query = query.filter(Notification.type == type)
    if read is not None:
        query = query.filter(Notification.read == int(read))
    if priority is not None:
        query = query.filter(Notification.priority == priority)
    rows = query.order_by(Notification.created_at.desc(), Notification.id.desc()).offset(offset).limit(limit).all()
    return [_serialize_notification(row) for row in rows]


@router.get("/unread-count")
def get_unread_count(
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, int]:
    count = (
        db.query(Notification)
        .filter(Notification.user_id == _resolve_user_id(request), Notification.read == 0)
        .count()
    )
    return {"count": count}


@router.put("/{notification_id}/read")
def mark_notification_as_read(
    notification_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    row = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == _resolve_user_id(request))
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    row.read = 1
    db.commit()
    db.refresh(row)
    return _serialize_notification(row)


@router.put("/read-all")
def mark_all_notifications_as_read(
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, int]:
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == _resolve_user_id(request), Notification.read == 0)
        .update({"read": 1}, synchronize_session=False)
    )
    db.commit()
    return {"updated": int(updated)}


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(
    notification_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    row = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == _resolve_user_id(request))
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_notification_endpoint(
    payload: NotificationCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    row = create_notification(
        db=db,
        user_id=_resolve_user_id(request),
        type=payload.type,
        title=payload.title,
        body=payload.body,
        ticker=payload.ticker,
        action_url=payload.action_url,
        priority=payload.priority,
    )
    return _serialize_notification(row)
