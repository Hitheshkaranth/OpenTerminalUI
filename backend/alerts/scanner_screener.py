from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend.models.core import AlertConditionType, AlertORM, AlertStatus


class ScreenerAlertResult:
    __slots__ = ("id", "name", "ticker", "alert_type", "condition", "threshold", "screener_config", "channels")

    def __init__(
        self,
        id: str,
        name: str,
        ticker: str,
        alert_type: str,
        condition: str,
        threshold: float,
        screener_config: dict,
        channels: list[str],
    ):
        self.id = id
        self.name = name
        self.ticker = ticker
        self.alert_type = alert_type
        self.condition = condition
        self.threshold = threshold
        self.screener_config = screener_config
        self.channels = channels


def create_screener_alert(
    db: Session,
    user_id: str,
    name: str,
    screener_config: dict,
    delivery_channels: list[str] | None = None,
    ticker: str | None = None,
) -> ScreenerAlertResult:
    alert_id = str(uuid.uuid4())
    channels = list(delivery_channels) if delivery_channels else ["in_app"]
    symbols = screener_config.get("symbols", [])
    first_ticker = symbols[0] if symbols else (ticker or "ALL")

    alert = AlertORM(
        id=alert_id,
        user_id=user_id,
        symbol=first_ticker,
        condition_type=AlertConditionType.SCREENER.value if hasattr(AlertConditionType, "SCREENER") else "screener",
        parameters={
            "name": name,
            "screener_config": screener_config,
        },
        status=AlertStatus.ACTIVE.value,
        delivery_channels=channels,
        created_at=datetime.now(timezone.utc),
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)

    return ScreenerAlertResult(
        id=alert.id,
        name=name,
        ticker=first_ticker,
        alert_type="screener",
        condition="screener_match",
        threshold=0,
        screener_config=screener_config,
        channels=channels,
    )