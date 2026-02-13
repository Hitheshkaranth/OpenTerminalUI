from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.db.models import AlertHistoryORM, AlertRuleORM

router = APIRouter()


class AlertCreate(BaseModel):
    ticker: str
    alert_type: str = Field(description="price|technical|fundamental|composite")
    condition: str = Field(description="above|below|crosses")
    threshold: float
    note: str = ""


@router.post("/alerts")
def create_alert(payload: AlertCreate, db: Session = Depends(get_db)) -> dict[str, object]:
    row = AlertRuleORM(
        ticker=payload.ticker.strip().upper(),
        alert_type=payload.alert_type.strip().lower(),
        condition=payload.condition.strip().lower(),
        threshold=float(payload.threshold),
        note=payload.note.strip(),
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"status": "created", "alert": {"id": row.id, "ticker": row.ticker}}


@router.get("/alerts")
def get_alerts(db: Session = Depends(get_db)) -> dict[str, list[dict[str, object]]]:
    rows = db.query(AlertRuleORM).order_by(AlertRuleORM.id.desc()).all()
    return {
        "alerts": [
            {
                "id": row.id,
                "ticker": row.ticker,
                "alert_type": row.alert_type,
                "condition": row.condition,
                "threshold": row.threshold,
                "note": row.note,
                "created_at": row.created_at,
            }
            for row in rows
        ]
    }


@router.get("/alerts/history")
def get_alert_history(db: Session = Depends(get_db)) -> dict[str, list[dict[str, object]]]:
    rows = db.query(AlertHistoryORM).order_by(AlertHistoryORM.id.desc()).limit(200).all()
    return {
        "history": [
            {
                "id": row.id,
                "rule_id": row.rule_id,
                "ticker": row.ticker,
                "message": row.message,
                "triggered_at": row.triggered_at,
            }
            for row in rows
        ]
    }


@router.post("/alerts/{alert_id}/trigger")
def trigger_alert(alert_id: int, message: str = "Triggered manually", db: Session = Depends(get_db)) -> dict[str, object]:
    rule = db.query(AlertRuleORM).filter(AlertRuleORM.id == alert_id).first()
    if rule is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    entry = AlertHistoryORM(
        rule_id=rule.id,
        ticker=rule.ticker,
        message=message,
        triggered_at=datetime.utcnow().isoformat(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"status": "triggered", "history_id": entry.id}


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: int, db: Session = Depends(get_db)) -> dict[str, object]:
    row = db.query(AlertRuleORM).filter(AlertRuleORM.id == alert_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": alert_id}
