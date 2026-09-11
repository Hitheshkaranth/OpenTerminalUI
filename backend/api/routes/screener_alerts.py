from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.alerts.scanner_screener import create_screener_alert
from backend.alerts.scanner_screener import ScreenerAlertResult
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models.user import User

router = APIRouter()


class ScreenerAlertCreate(BaseModel):
    name: str
    screener_config: dict[str, Any]
    delivery_channels: list[str] | None = None
    ticker: str | None = None


@router.post("/screener-alerts")
async def create_screener_alert_endpoint(
    payload: ScreenerAlertCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        alert = create_screener_alert(
            db=db,
            user_id=current_user.id,
            name=payload.name,
            screener_config=payload.screener_config,
            delivery_channels=payload.delivery_channels,
            ticker=payload.ticker,
        )
        return {
            "status": "created",
            "alert": {
                "id": alert.id,
                "name": alert.name,
                "ticker": alert.ticker,
                "channels": alert.channels,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))