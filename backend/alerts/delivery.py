from __future__ import annotations

from typing import Any

try:
    import aiohttp
except ImportError:  # pragma: no cover
    aiohttp = None
import httpx
from sqlalchemy.orm import Session

from backend.api.routes.notifications import create_notification


async def _post_json(url: str, payload: dict[str, Any], timeout_seconds: float = 10.0) -> None:
    if aiohttp is not None:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=timeout_seconds)) as response:
                response.raise_for_status()
        return

    async with httpx.AsyncClient(timeout=timeout_seconds, trust_env=False) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()


async def deliver_in_app(db: Session, alert: Any, message: str) -> None:
    create_notification(
        db=db,
        user_id=str(getattr(alert, "user_id", "1")),
        type="alert",
        title=f"Alert: {getattr(alert, 'symbol', 'UNKNOWN')}",
        body=message,
        ticker=str(getattr(alert, "symbol", "")).split(":")[-1] or None,
        action_url="/equity/alerts",
        priority="high",
    )


async def deliver_webhook(url: str, payload: dict[str, Any]) -> None:
    await _post_json(url, payload, timeout_seconds=10.0)


async def deliver_telegram(token: str, chat_id: str, message: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    await _post_json(url, {"chat_id": chat_id, "text": message, "parse_mode": "HTML"}, timeout_seconds=10.0)


async def deliver_discord(webhook_url: str, message: str) -> None:
    await _post_json(webhook_url, {"content": message}, timeout_seconds=10.0)


async def deliver_alert(alert: Any, message: str, db: Session | None = None) -> None:
    config = getattr(alert, "delivery_config", None) or {}
    channels = getattr(alert, "delivery_channels", None) or ["in_app"]

    for channel in channels:
        try:
            if channel == "in_app" and db is not None:
                await deliver_in_app(db, alert, message)
            elif channel == "webhook" and config.get("webhook_url"):
                await deliver_webhook(
                    str(config["webhook_url"]),
                    {
                        "alert_id": getattr(alert, "id", None),
                        "symbol": getattr(alert, "symbol", None),
                        "message": message,
                    },
                )
            elif channel == "telegram" and config.get("telegram_token") and config.get("telegram_chat_id"):
                await deliver_telegram(str(config["telegram_token"]), str(config["telegram_chat_id"]), message)
            elif channel == "discord" and config.get("discord_webhook_url"):
                await deliver_discord(str(config["discord_webhook_url"]), message)
        except Exception as exc:  # pragma: no cover
            print(f"Delivery failed for {channel}: {exc}")
