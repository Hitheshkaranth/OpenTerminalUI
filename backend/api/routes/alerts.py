from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.alerts.delivery import deliver_alert
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import AlertConditionType, AlertORM, AlertStatus, AlertTriggerORM, User

router = APIRouter()

SUPPORTED_DELIVERY_CHANNELS = {
    "in_app": {"label": "In-App", "required_config": []},
    "webhook": {"label": "Webhook", "required_config": ["webhook_url"]},
    "telegram": {"label": "Telegram", "required_config": ["telegram_token", "telegram_chat_id"]},
    "discord": {"label": "Discord", "required_config": ["discord_webhook_url"]},
    "email": {"label": "Email", "required_config": ["email_to"]},
    "push": {"label": "Push", "required_config": []},
}


class AlertCreate(BaseModel):
    symbol: str | None = None
    condition_type: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    cooldown_seconds: int = 0
    status: str = AlertStatus.ACTIVE.value
    conditions: list[dict[str, Any]] = Field(default_factory=list)
    logic: str = "AND"
    delivery_channels: list[str] | None = None
    delivery_config: dict[str, Any] = Field(default_factory=dict)
    cooldown_minutes: int = 0
    expiry_date: datetime | None = None
    max_triggers: int = 0
    # Legacy compatibility
    ticker: str | None = None
    alert_type: str | None = None
    condition: str | None = None
    threshold: float | None = None
    note: str = ""
    channels: list[str] | None = None


class AlertUpdate(BaseModel):
    parameters: dict[str, Any] | None = None
    status: str | None = None
    cooldown_seconds: int | None = None
    channels: list[str] | None = None
    conditions: list[dict[str, Any]] | None = None
    logic: str | None = None
    delivery_channels: list[str] | None = None
    delivery_config: dict[str, Any] | None = None
    cooldown_minutes: int | None = None
    expiry_date: datetime | None = None
    max_triggers: int | None = None


def _normalize_channel_name(value: Any) -> str:
    key = str(value or "").strip().lower()
    if key in {"telegram", "webhook", "in_app", "discord", "email", "push"}:
        return key
    return ""


def _normalize_channels(
    payload_channels: list[str] | None,
    delivery_channels: list[str] | None,
    parameters: dict[str, Any],
) -> list[str]:
    raw = delivery_channels if delivery_channels is not None else payload_channels
    if raw is None:
        raw = parameters.get("channels")
    if not isinstance(raw, list):
        return ["in_app"]
    out: list[str] = []
    for value in raw:
        key = _normalize_channel_name(value)
        if key and key not in out:
            out.append(key)
    return out or ["in_app"]


def _normalize_delivery_config(payload: AlertCreate | AlertUpdate, parameters: dict[str, Any]) -> dict[str, Any]:
    if isinstance(payload, AlertCreate):
        raw = dict(payload.delivery_config or {})
    else:
        raw = dict(payload.delivery_config or {})
    legacy_aliases = {
        "webhook_url": parameters.get("webhook_url"),
        "telegram_token": parameters.get("telegram_token") or parameters.get("telegram_bot_token"),
        "telegram_chat_id": parameters.get("telegram_chat_id"),
        "discord_webhook_url": parameters.get("discord_webhook_url"),
        "email_to": parameters.get("email_to"),
    }
    for key, value in legacy_aliases.items():
        if value not in (None, "") and key not in raw:
            raw[key] = value
    return raw


def _channel_status(channels: list[str], config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    configured_email = bool(os.getenv("SMTP_HOST", "").strip()) and bool(str(config.get("email_to") or "").strip())
    status_map = {
        "in_app": {"enabled": "in_app" in channels, "configured": True},
        "telegram": {
            "enabled": "telegram" in channels,
            "configured": bool(str(config.get("telegram_token") or "").strip())
            and bool(str(config.get("telegram_chat_id") or "").strip()),
        },
        "webhook": {"enabled": "webhook" in channels, "configured": bool(str(config.get("webhook_url") or "").strip())},
        "discord": {
            "enabled": "discord" in channels,
            "configured": bool(str(config.get("discord_webhook_url") or "").strip()),
        },
        "email": {"enabled": "email" in channels, "configured": configured_email},
        "push": {"enabled": "push" in channels, "configured": True},
    }
    return status_map


def _channel_configuration_errors(channels: list[str], config: dict[str, Any]) -> list[str]:
    status_map = _channel_status(channels, config)
    errors: list[str] = []
    for channel in channels:
        if channel not in status_map:
            continue
        if status_map[channel]["enabled"] and not status_map[channel]["configured"]:
            required = SUPPORTED_DELIVERY_CHANNELS.get(channel, {}).get("required_config", [])
            suffix = f" (set {', '.join(required)})" if required else ""
            errors.append(f"{channel}{suffix}")
    return errors


def _ensure_configured_channels(channels: list[str], config: dict[str, Any]) -> None:
    errors = _channel_configuration_errors(channels, config)
    if not errors:
        return
    raise HTTPException(
        status_code=400,
        detail=(
            "Selected delivery channels are not configured: "
            f"{', '.join(errors)}. Remove those channels or add the required channel settings."
        ),
    )


def _normalize_logic(value: str | None) -> str:
    logic = str(value or "AND").strip().upper()
    if logic not in {"AND", "OR"}:
        raise HTTPException(status_code=400, detail="logic must be AND or OR")
    return logic


def _normalize_conditions(conditions: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for raw in conditions or []:
        if not isinstance(raw, dict):
            continue
        field = str(raw.get("field") or "").strip().lower()
        operator = str(raw.get("operator") or "").strip().lower()
        params = raw.get("params") if isinstance(raw.get("params"), dict) else {}
        if not field or not operator:
            continue
        normalized.append(
            {
                "field": field,
                "operator": operator,
                "value": raw.get("value"),
                "params": params,
            }
        )
    return normalized


def _legacy_to_v2(payload: AlertCreate) -> tuple[str, str, dict[str, Any], list[dict[str, Any]]]:
    symbol = str(payload.symbol or payload.ticker or "").strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")

    if payload.conditions:
        conditions = _normalize_conditions(payload.conditions)
        if not conditions:
            raise HTTPException(status_code=400, detail="At least one valid condition is required")
        condition_type = payload.condition_type or AlertConditionType.MULTI_CONDITION.value
        return symbol, condition_type, dict(payload.parameters or {}), conditions

    if payload.condition_type:
        return symbol, payload.condition_type, dict(payload.parameters or {}), []

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
    return symbol, ctype, params, []


def _legacy_condition_type_to_conditions(row: AlertORM) -> list[dict[str, Any]]:
    params = row.parameters if isinstance(row.parameters, dict) else {}
    ctype = str(row.condition_type or "")
    if ctype == AlertConditionType.PRICE_ABOVE.value:
        return [{"field": "price", "operator": "above", "value": params.get("threshold"), "params": {}}]
    if ctype == AlertConditionType.PRICE_BELOW.value:
        return [{"field": "price", "operator": "below", "value": params.get("threshold"), "params": {}}]
    if ctype == AlertConditionType.PCT_CHANGE.value:
        direction = str(params.get("direction") or "above").strip().lower()
        return [{"field": "change_pct", "operator": direction, "value": params.get("threshold"), "params": {}}]
    if ctype == AlertConditionType.VOLUME_SPIKE.value:
        return [
            {
                "field": "volume",
                "operator": "spike",
                "value": params.get("threshold") or params.get("multiplier"),
                "params": {"multiplier": params.get("multiplier", 2)},
            }
        ]
    if ctype == AlertConditionType.INDICATOR_CROSSOVER.value:
        indicator = str(params.get("indicator") or "").strip().lower()
        direction = str(params.get("direction") or "above").strip().lower()
        if indicator == "rsi":
            return [{"field": "rsi_14", "operator": direction, "value": params.get("level", 70), "params": {"period": params.get("period", 14)}}]
        if indicator == "macd":
            return [{"field": "macd_signal", "operator": f"cross_{direction}", "value": 0, "params": {}}]
        if indicator == "ma":
            return [
                {
                    "field": "ema_cross",
                    "operator": f"cross_{direction}",
                    "value": 0,
                    "params": {"fast_period": params.get("fast", 9), "slow_period": params.get("slow", 21)},
                }
            ]
    return []


def _serialize_alert(row: AlertORM) -> dict[str, Any]:
    params = row.parameters if isinstance(row.parameters, dict) else {}
    conditions = row.conditions if isinstance(row.conditions, list) and row.conditions else _legacy_condition_type_to_conditions(row)
    channels = _normalize_channels(None, row.delivery_channels if isinstance(row.delivery_channels, list) else None, params)
    config = row.delivery_config if isinstance(row.delivery_config, dict) else _normalize_delivery_config(AlertUpdate(), params)
    return {
        "id": row.id,
        "symbol": row.symbol,
        "condition_type": row.condition_type,
        "parameters": params,
        "status": row.status,
        "created_at": row.created_at.isoformat() if isinstance(row.created_at, datetime) else str(row.created_at),
        "triggered_at": row.triggered_at.isoformat() if isinstance(row.triggered_at, datetime) else None,
        "cooldown_seconds": row.cooldown_seconds,
        "conditions": conditions,
        "logic": row.logic or "AND",
        "delivery_channels": channels,
        "delivery_config": config,
        "cooldown_minutes": int(row.cooldown_minutes or 0),
        "last_triggered_at": row.last_triggered_at.isoformat() if isinstance(row.last_triggered_at, datetime) else None,
        "expiry_date": row.expiry_date.isoformat() if isinstance(row.expiry_date, datetime) else None,
        "max_triggers": int(row.max_triggers or 0),
        "trigger_count": int(row.trigger_count or 0),
        "channels": channels,
        "channel_status": _channel_status(channels, config),
        "ticker": row.symbol.split(":")[-1],
        "alert_type": "price",
        "condition": "above" if row.condition_type == AlertConditionType.PRICE_ABOVE.value else "below",
        "threshold": params.get("threshold"),
        "note": str(params.get("note") or ""),
    }


@router.post("/alerts")
def create_alert(
    payload: AlertCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    symbol, condition_type, parameters, conditions = _legacy_to_v2(payload)
    channels = _normalize_channels(payload.channels, payload.delivery_channels, parameters)
    config = _normalize_delivery_config(payload, parameters)
    _ensure_configured_channels(channels, config)
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
        conditions=conditions,
        logic=_normalize_logic(payload.logic),
        delivery_channels=channels,
        delivery_config=config,
        cooldown_minutes=max(0, int(payload.cooldown_minutes or 0)),
        expiry_date=payload.expiry_date,
        max_triggers=max(0, int(payload.max_triggers or 0)),
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return {"status": "created", "alert": _serialize_alert(alert)}


@router.get("/alerts")
def list_alerts(
    status: str | None = Query(default=None),
    symbol: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, list[dict[str, Any]]]:
    query = db.query(AlertORM).filter(AlertORM.user_id == current_user.id)
    if status:
        query = query.filter(AlertORM.status == status.strip().lower())
    if symbol:
        normalized = symbol.strip().upper()
        suffix = normalized.split(":", 1)[-1]
        query = query.filter(
            or_(
                AlertORM.symbol == normalized,
                AlertORM.symbol == suffix,
                AlertORM.symbol.like(f"%:{suffix}"),
            )
        )
    rows = query.order_by(AlertORM.created_at.desc()).all()
    return {"alerts": [_serialize_alert(row) for row in rows]}


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

    params = row.parameters if isinstance(row.parameters, dict) else {}
    if payload.parameters is not None:
        params = dict(payload.parameters)
        row.parameters = params
    if payload.conditions is not None:
        normalized_conditions = _normalize_conditions(payload.conditions)
        if payload.conditions and not normalized_conditions:
            raise HTTPException(status_code=400, detail="At least one valid condition is required")
        row.conditions = normalized_conditions
        if normalized_conditions and row.condition_type != AlertConditionType.MULTI_CONDITION.value:
            row.condition_type = AlertConditionType.MULTI_CONDITION.value
    if payload.logic is not None:
        row.logic = _normalize_logic(payload.logic)
    if payload.cooldown_seconds is not None:
        row.cooldown_seconds = max(0, int(payload.cooldown_seconds))
    if payload.cooldown_minutes is not None:
        row.cooldown_minutes = max(0, int(payload.cooldown_minutes))
    if payload.expiry_date is not None:
        row.expiry_date = payload.expiry_date
    if payload.max_triggers is not None:
        row.max_triggers = max(0, int(payload.max_triggers))
    if payload.status is not None:
        status = payload.status.strip().lower()
        if status not in {x.value for x in AlertStatus}:
            raise HTTPException(status_code=400, detail="Invalid status")
        row.status = status

    channels = _normalize_channels(payload.channels, payload.delivery_channels, params)
    config = _normalize_delivery_config(payload, params)
    if (
        payload.channels is not None
        or payload.delivery_channels is not None
        or payload.delivery_config is not None
        or payload.parameters is not None
    ):
        _ensure_configured_channels(channels, config)
        row.delivery_channels = channels
        row.delivery_config = config

    db.commit()
    db.refresh(row)
    alert = _serialize_alert(row)
    return {"status": "updated", "id": row.id, "channels": alert["channels"], "channel_status": alert["channel_status"], "alert": alert}


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


@router.post("/alerts/{alert_id}/test")
async def test_alert_delivery(
    alert_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = db.query(AlertORM).filter(AlertORM.id == alert_id, AlertORM.user_id == current_user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    await deliver_alert(row, f"Test alert for {row.symbol}", db=db)
    return {"status": "sent", "id": row.id, "channels": _serialize_alert(row)["channels"]}


@router.get("/alerts/delivery-options")
def get_delivery_options() -> dict[str, Any]:
    channels = {}
    for key, meta in SUPPORTED_DELIVERY_CHANNELS.items():
        channels[key] = {
            "label": meta["label"],
            "required_config": meta["required_config"],
            "available": True if key != "email" else bool(os.getenv("SMTP_HOST", "").strip()),
        }
    return {"channels": channels}


@router.get("/alerts/channels/status")
def get_alert_channel_status() -> dict[str, Any]:
    return {
        "channels": {
            key: {"available": value["available"], "configured": value["available"]}
            for key, value in get_delivery_options()["channels"].items()
        }
    }
