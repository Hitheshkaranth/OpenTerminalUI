from __future__ import annotations

import asyncio
import logging
import socket
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import httpx
from sqlalchemy.orm import Session

from backend.api.routes.notifications import create_notification
from backend.core.research.network import resolve_public_target

logger = logging.getLogger(__name__)

_DISCORD_HOSTS = {"discord.com", "discordapp.com"}
_DISCORD_PATH_PREFIX = "/api/webhooks/"


class OutboundURLError(ValueError):
    """A user-supplied webhook URL is not an allowed public destination."""


def check_outbound_url_static(url: str, *, discord: bool = False) -> httpx.URL:
    """Checks that need no DNS: scheme, credentials, port, Discord host/path (SEC-7)."""
    from backend.config.security import is_development_env

    try:
        parsed = httpx.URL(str(url or "").strip())
    except Exception as exc:  # noqa: BLE001 - httpx raises several types for junk input
        raise OutboundURLError("Webhook URL is not a valid URL") from exc
    allowed_schemes = {"https", "http"} if is_development_env() else {"https"}
    if parsed.scheme not in allowed_schemes:
        raise OutboundURLError("Webhook URL must use https")
    if not parsed.host or parsed.username or parsed.password:
        raise OutboundURLError("Webhook URL must have a host and no credentials")
    if parsed.port not in (None, 80, 443):
        raise OutboundURLError("Webhook URL must use a standard HTTP(S) port")
    if discord:
        if parsed.scheme != "https" or parsed.host.lower() not in _DISCORD_HOSTS or not parsed.path.startswith(_DISCORD_PATH_PREFIX):
            raise OutboundURLError("Discord webhook URL must be https://discord.com/api/webhooks/...")
    return parsed


async def resolve_outbound_url(url: str, *, discord: bool = False) -> tuple[httpx.URL, str, str]:
    """Full validation incl. DNS; returns (pinned URL, hostname, Host header)."""
    check_outbound_url_static(url, discord=discord)
    try:
        return await resolve_public_target(str(url).strip())
    except ValueError as exc:
        raise OutboundURLError("Webhook URL must resolve to a public address") from exc


def validate_outbound_url_for_storage(url: str, *, discord: bool = False) -> None:
    """Create/update-time check for sync routes. Raises OutboundURLError for bad URLs.

    A DNS lookup failure is not treated as a rejection here (the host may be
    temporarily unresolvable); delivery re-validates and pins the address.
    """
    check_outbound_url_static(url, discord=discord)
    try:
        asyncio.run(resolve_public_target(str(url).strip()))
    except ValueError as exc:
        raise OutboundURLError("Webhook URL must resolve to a public address") from exc
    except (OSError, socket.gaierror, asyncio.TimeoutError, TimeoutError):
        logger.info("Webhook host could not be resolved at save time; it will be checked at delivery")


@asynccontextmanager
async def _outbound_client() -> AsyncIterator[httpx.AsyncClient]:
    try:
        from backend.shared.http_client import get_http_client
    except ImportError:
        async with httpx.AsyncClient(
            trust_env=False, follow_redirects=False, timeout=httpx.Timeout(15, connect=5)
        ) as client:
            yield client
        return
    yield get_http_client()


async def post_json_pinned(
    url: str,
    payload: dict[str, Any],
    *,
    discord: bool = False,
    timeout_seconds: float = 10.0,
) -> httpx.Response:
    """POST to a validated public address pinned from DNS; redirects are never followed."""
    pinned, hostname, host_header = await resolve_outbound_url(url, discord=discord)
    async with _outbound_client() as client:
        return await client.post(
            pinned,
            json=payload,
            headers={"Host": host_header},
            extensions={"sni_hostname": hostname},
            follow_redirects=False,
            timeout=timeout_seconds,
        )


async def _post_fixed_host(url: str, payload: dict[str, Any], timeout_seconds: float = 10.0) -> None:
    """POST to a hard-coded provider host (Telegram)."""
    async with _outbound_client() as client:
        response = await client.post(url, json=payload, follow_redirects=False, timeout=timeout_seconds)
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
    response = await post_json_pinned(url, payload, timeout_seconds=10.0)
    response.raise_for_status()


async def deliver_telegram(token: str, chat_id: str, message: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    await _post_fixed_host(url, {"chat_id": chat_id, "text": message, "parse_mode": "HTML"}, timeout_seconds=10.0)


async def deliver_discord(webhook_url: str, message: str) -> None:
    response = await post_json_pinned(webhook_url, {"content": message}, discord=True, timeout_seconds=10.0)
    response.raise_for_status()


async def deliver_alert(alert: Any, message: str, db: Session | None = None) -> None:
    config = getattr(alert, "delivery_config", None) or {}
    channels = list(getattr(alert, "delivery_channels", None) or ["in_app"])

    # Database work first, so no transaction is open during network delivery.
    if "in_app" in channels and db is not None:
        try:
            await deliver_in_app(db, alert, message)
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            logger.warning("In-app delivery failed for alert %s: %s", getattr(alert, "id", None), type(exc).__name__)
        else:
            db.commit()  # end the read transaction so no connection is held during network I/O

    for channel in channels:
        try:
            if channel == "webhook" and config.get("webhook_url"):
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
        except Exception as exc:  # noqa: BLE001
            # Exception text can embed the target URL (Telegram bot token, Discord webhook secret) — log the type only.
            logger.warning("Delivery failed for %s on alert %s: %s", channel, getattr(alert, "id", None), type(exc).__name__)
