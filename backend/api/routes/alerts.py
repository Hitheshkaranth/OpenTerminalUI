from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import AlertConditionType, AlertORM, AlertStatus, AlertTriggerORM, User

router = APIRouter()


class AlertCreate(BaseModel):
    symbol: str | None = None
    condition_type: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    cooldown_seconds: int = 0
    status: str = AlertStatus.ACTIVE.value
    # Legacy compatibility
    ticker: str | None = None
    alert_type: str | None = None
    condition: str | None = None
    threshold: float | None = None
    note: str = ""
    channels: list[str] = Field(default_factory=list)


class AlertUpdate(BaseModel):
    parameters: dict[str, Any] | None = None
    status: str | None = None
    cooldown_seconds: int | None = None
    channels: list[str] | None = None


def _normalize_channels(payload_channels: list[str] | None, parameters: dict[str, Any]) -> list[str]:
    raw = payload_channels if payload_channels is not None else parameters.get("channels")
    if not isinstance(raw, list):
        return ["in_app"]
    out: list[str] = []
    for value in raw:
        key = str(value or "").strip().lower()
        if key in {"in_app", "telegram", "webhook", "email", "push"} and key not in out:
            out.append(key)
    return out or ["in_app"]


def _channel_status(channels: list[str], parameters: dict[str, Any]) -> dict[str, dict[str, Any]]:
    configured_email = bool(os.getenv("SMTP_HOST", "").strip()) and bool(str(parameters.get("email_to") or "").strip())
    configured_webhook = bool(str(parameters.get("webhook_url") or "").strip())
    configured_telegram = bool(str(parameters.get("telegram_bot_token") or "").strip()) and bool(
        str(parameters.get("telegram_chat_id") or "").strip()
    )
    configured_push = True  # Browser push registration is client-managed.

    status_map = {
        "in_app": {"enabled": "in_app" in channels, "configured": True},
        "telegram": {"enabled": "telegram" in channels, "configured": configured_telegram},
        "webhook": {"enabled": "webhook" in channels, "configured": configured_webhook},
        "email": {"enabled": "email" in channels, "configured": configured_email},
        "push": {"enabled": "push" in channels, "configured": configured_push},
    }
    return status_map


def _legacy_to_v2(payload: AlertCreate) -> tuple[str, str, dict[str, Any]]:
    symbol = str(payload.symbol or payload.ticker or "").strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")
    if payload.condition_type:
        return symbol, payload.condition_type, dict(payload.parameters or {})

    legacy_condition = str(payload.condition or "").strip().lower()
    threshold = payload.threshold
    if threshold is None:
        raise HTTPException(status_code=400, detail="threshold is required")
    if legacy_condition == "above":
        ctype = AlertConditionType.PRICE_ABOVE.value
    elif legacy_condition == "below":
        ctype = AlertConditionType.PRICE_BELOW.value
    else:
        ctype = AlertConditionType.CUSTOM_EXPRESSION.value
    params = {"threshold": float(threshold)}
    if payload.note:
        params["note"] = payload.note
    return symbol, ctype, params


@router.post("/alerts")
def create_alert(
    payload: AlertCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    symbol, condition_type, parameters = _legacy_to_v2(payload)
    channels = _normalize_channels(payload.channels, parameters)
    parameters["channels"] = channels
    status = str(payload.status or AlertStatus.ACTIVE.value).strip().lower()
    if status not in {x.value for x in AlertStatus}:
        raise HTTPException(status_code=400, detail="Invalid status")
    alert = AlertORM(
        user_id=current_user.id,
        symbol=symbol,
        condition_type=condition_type,
        parameters=parameters,
        status=status,
        cooldown_seconds=max(0, int(payload.cooldown_seconds or 0)),
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return {
        "status": "created",
        "alert": {
            "id": alert.id,
            "symbol": alert.symbol,
            "condition_type": alert.condition_type,
            "status": alert.status,
            "channels": channels,
            "channel_status": _channel_status(channels, parameters),
        },
    }


@router.get("/alerts")
def list_alerts(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, list[dict[str, Any]]]:
    query = db.query(AlertORM).filter(AlertORM.user_id == current_user.id)
    if status:
        query = query.filter(AlertORM.status == status.strip().lower())
    rows = query.order_by(AlertORM.created_at.desc()).all()
    alerts = []
    for row in rows:
        params = row.parameters if isinstance(row.parameters, dict) else {}
        channels = _normalize_channels(None, params)
        alerts.append(
            {
                "id": row.id,
                "symbol": row.symbol,
                "condition_type": row.condition_type,
                "parameters": params,
                "status": row.status,
                "created_at": row.created_at.isoformat() if isinstance(row.created_at, datetime) else str(row.created_at),
                "triggered_at": row.triggered_at.isoformat() if isinstance(row.triggered_at, datetime) else None,
                "cooldown_seconds": row.cooldown_seconds,
                "channels": channels,
                "channel_status": _channel_status(channels, params),
                # Legacy keys for existing frontend table.
                "ticker": row.symbol.split(":")[-1],
                "alert_type": "price",
                "condition": "above" if row.condition_type == AlertConditionType.PRICE_ABOVE.value else "below",
                "threshold": params.get("threshold"),
                "note": str(params.get("note") or ""),
            }
        )
    return {"alerts": alerts}


@router.get("/alerts/history")
def alert_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    offset = (page - 1) * page_size
    total = db.query(AlertTriggerORM).filter(AlertTriggerORM.user_id == current_user.id).count()
    rows = (
        db.query(AlertTriggerORM)
        .filter(AlertTriggerORM.user_id == current_user.id)
        .order_by(AlertTriggerORM.triggered_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "history": [
            {
                "id": row.id,
                "alert_id": row.alert_id,
                "symbol": row.symbol,
                "condition_type": row.condition_type,
                "triggered_value": row.triggered_value,
                "context": row.context if isinstance(row.context, dict) else {},
                "triggered_at": row.triggered_at.isoformat(),
            }
            for row in rows
        ],
    }


@router.patch("/alerts/{alert_id}")
def update_alert(
    alert_id: str,
    payload: AlertUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = db.query(AlertORM).filter(AlertORM.id == alert_id, AlertORM.user_id == current_user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    if payload.parameters is not None:
        row.parameters = dict(payload.parameters)
    params = row.parameters if isinstance(row.parameters, dict) else {}
    if payload.channels is not None:
        params["channels"] = _normalize_channels(payload.channels, params)
        row.parameters = params
    if payload.cooldown_seconds is not None:
        row.cooldown_seconds = max(0, int(payload.cooldown_seconds))
    if payload.status is not None:
        status = payload.status.strip().lower()
        if status not in {x.value for x in AlertStatus}:
            raise HTTPException(status_code=400, detail="Invalid status")
        row.status = status
    db.commit()
    channels = _normalize_channels(None, params)
    return {"status": "updated", "id": row.id, "channels": channels, "channel_status": _channel_status(channels, params)}


@router.delete("/alerts/{alert_id}")
def delete_alert(
    alert_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = db.query(AlertORM).filter(AlertORM.id == alert_id, AlertORM.user_id == current_user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    row.status = AlertStatus.DELETED.value
    db.commit()
    return {"status": "deleted", "id": alert_id}


@router.get("/alerts/channels/status")
def get_alert_channel_status() -> dict[str, Any]:
    return {
        "channels": {
            "in_app": {"available": True, "configured": True},
            "telegram": {"available": True, "configured": False},
            "webhook": {"available": True, "configured": True},
            "email": {"available": bool(os.getenv("SMTP_HOST", "").strip()), "configured": bool(os.getenv("SMTP_HOST", "").strip())},
            "push": {"available": True, "configured": True},
        }
    }
