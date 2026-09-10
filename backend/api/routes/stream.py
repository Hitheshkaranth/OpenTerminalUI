from __future__ import annotations

import logging
import os
import secrets
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import jwt, JWTError

from backend.services.marketdata_hub import get_marketdata_hub
from backend.services.orderbook_service import service as orderbook_service
from backend.services.us_tick_stream import get_us_tick_stream_service
from backend.config.security import get_jwt_secret

router = APIRouter()
logger = logging.getLogger(__name__)
service = orderbook_service

# Allowed CORS origins for WebSocket connections (mirror of CORS allowlist)
_WS_ORIGIN_ALLOWLIST = frozenset(
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ]
)


def _validate_ws_origin(header: str | None) -> bool:
    """Check that the WebSocket Origin header is in the allowlist.

    A missing Origin is allowed. This check defends against cross-site WebSocket
    hijacking, which only a browser can be tricked into, and browsers always send
    Origin on the handshake. Non-browser clients (scripts, CLIs, the test suite)
    send none, and a non-browser attacker can spoof the header anyway, so rejecting
    headerless clients breaks them without adding protection.
    """
    if header is None:
        return True
    if not header.strip():
        return False
    origin = header.strip()
    if origin in _WS_ORIGIN_ALLOWLIST:
        return True
    # Also allow localhost variants that might differ in port
    try:
        from urllib.parse import urlparse

        parsed = urlparse(origin)
        if parsed.hostname in {"localhost", "127.0.0.1"}:
            return True
    except Exception:
        pass
    return False


def _validate_ws_jwt(token: str) -> dict | None:
    """Validate a JWT from a query param or header, return payload or None."""
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
        if str(payload.get("type", "")) == "access":
            return payload
    except (JWTError, Exception):
        pass
    return None


def _symbols_from_payload(payload: dict[str, Any]) -> list[str]:
    symbols = payload.get("symbols")
    if not isinstance(symbols, list):
        return []
    out: list[str] = []
    for item in symbols:
        if isinstance(item, str):
            out.append(item.strip().upper())
    return out


def _channels_from_payload(payload: dict[str, Any]) -> list[str]:
    channels = payload.get("channels")
    if not isinstance(channels, list):
        return []
    out: list[str] = []
    for item in channels:
        if isinstance(item, str):
            out.append(item.strip().lower())
    return out


def _market_from_payload(payload: dict[str, Any]) -> str:
    market = payload.get("market") if isinstance(payload, dict) else None
    if isinstance(market, str) and market.strip():
        return market.strip()
    market_hint = payload.get("market_hint") if isinstance(payload, dict) else None
    if isinstance(market_hint, str) and market_hint.strip():
        return market_hint.strip()
    return "US"


async def _authenticate_ws(websocket: WebSocket) -> bool:
    """Validate Origin header and JWT token on WebSocket connection.

    Returns True if authentication passes, False if we should close the connection.
    """
    origin = websocket.headers.get("origin") or websocket.headers.get("Origin")
    if not _validate_ws_origin(origin):
        try:
            await websocket.close(code=403, reason="Origin not allowed")
        except Exception:
            pass
        return False

    # Extract JWT from query parameter (e.g. ?token=eyJ...) or Authorization header
    token = None
    # Check query parameters first (common for WebSocket connections)
    query_params = websocket.query_params
    candidate = query_params.get("token") or query_params.get("access_token")
    if candidate:
        token = candidate
    else:
        # Check Authorization header
        auth_header = websocket.headers.get("authorization") or websocket.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()

    if token and not _validate_ws_jwt(token):
        try:
            await websocket.close(code=401, reason="Invalid or expired token")
        except Exception:
            pass
        return False

    return True


async def _send_depth_snapshots(websocket: WebSocket, symbols: list[str], market: str, levels: int = 10) -> None:
    for symbol in symbols:
        snapshot = service.stream_message(symbol, market_hint=market, levels=levels)
        await websocket.send_json(snapshot)


@router.websocket("/ws/quotes")
async def ws_quotes(websocket: WebSocket) -> None:
    hub = get_marketdata_hub()
    if not await _authenticate_ws(websocket):
        return
    await websocket.accept()
    await hub.register(websocket)

    try:
        while True:
            payload = await websocket.receive_json()
            if not isinstance(payload, dict):
                await websocket.send_json({"type": "error", "message": "Invalid message payload"})
                continue

            op = str(payload.get("op") or "").strip().lower()
            if op == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if op == "subscribe":
                symbols = _symbols_from_payload(payload)
                accepted = await hub.subscribe(websocket, symbols)
                if not accepted:
                    await websocket.send_json({"type": "error", "message": "No valid symbols to subscribe"})
                    continue
                channels = _channels_from_payload(payload)
                if "depth" in channels:
                    market = _market_from_payload(payload)
                    await _send_depth_snapshots(websocket, symbols, market)
                continue

            if op == "unsubscribe":
                symbols = _symbols_from_payload(payload)
                await hub.unsubscribe(websocket, symbols)
                continue

            await websocket.send_json({"type": "error", "message": f"Unsupported op: {op or 'unknown'}"})
    except WebSocketDisconnect:
        logger.debug("WS quotes client disconnected")
    except Exception as exc:
        logger.exception("WS quotes error: %s", exc)
        try:
            await websocket.send_json({"type": "error", "message": "Internal server error"})
        except Exception:
            pass
    finally:
        await hub.unregister(websocket)


@router.websocket("/ws/alerts")
async def ws_alerts(websocket: WebSocket) -> None:
    hub = get_marketdata_hub()
    if not await _authenticate_ws(websocket):
        return
    await websocket.accept()
    await hub.register_alert_socket(websocket)
    try:
        while True:
            payload = await websocket.receive_json()
            op = str(payload.get("op") or "").strip().lower() if isinstance(payload, dict) else ""
            if op == "ping":
                await websocket.send_json({"type": "pong"})
            else:
                await websocket.send_json({"type": "info", "message": "alerts channel is push-only"})
    except WebSocketDisconnect:
        logger.debug("WS alerts client disconnected")
    except Exception as exc:
        logger.exception("WS alerts error: %s", exc)
    finally:
        await hub.unregister_alert_socket(websocket)


@router.websocket("/ws/us-quotes")
async def ws_us_quotes(websocket: WebSocket) -> None:
    us_service = get_us_tick_stream_service()
    if not await _authenticate_ws(websocket):
        return
    await websocket.accept()
    await us_service.register(websocket)
    try:
        await websocket.send_json({"type": "ready", "channels": ["trades", "bars"]})
        while True:
            payload = await websocket.receive_json()
            if not isinstance(payload, dict):
                await websocket.send_json({"type": "error", "message": "Invalid message payload"})
                continue
            op = str(payload.get("op") or "").strip().lower()
            if op == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            symbols = _symbols_from_payload(payload)
            channels = _channels_from_payload(payload)
            if op == "subscribe":
                result = await us_service.subscribe(websocket, symbols, channels)
                await websocket.send_json({"type": "subscribed", **result})
                continue
            if op == "unsubscribe":
                result = await us_service.unsubscribe(websocket, symbols, channels)
                await websocket.send_json({"type": "unsubscribed", **result})
                continue
            await websocket.send_json({"type": "error", "message": f"Unsupported op: {op or 'unknown'}"})
    except WebSocketDisconnect:
        logger.debug("WS us-quotes client disconnected")
    except Exception as exc:
        logger.exception("WS us-quotes error: %s", exc)
        try:
            await websocket.send_json({"type": "error", "message": "Internal server error"})
        except Exception:
            pass
    finally:
        await us_service.unregister(websocket)


@router.websocket("/ws/depth")
async def ws_depth(websocket: WebSocket) -> None:
    if not await _authenticate_ws(websocket):
        return
    await websocket.accept()
    await websocket.send_json({"type": "ready", "channels": ["depth"]})
    try:
        while True:
            payload = await websocket.receive_json()
            if not isinstance(payload, dict):
                await websocket.send_json({"type": "error", "message": "Invalid message payload"})
                continue

            op = str(payload.get("op") or "").strip().lower()
            if op == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if op == "subscribe":
                symbols = _symbols_from_payload(payload)
                if not symbols:
                    await websocket.send_json({"type": "error", "message": "No valid symbols to subscribe"})
                    continue
                market = _market_from_payload(payload)
                await websocket.send_json({"type": "subscribed", "symbols": symbols, "market": market, "channels": ["depth"]})
                await _send_depth_snapshots(websocket, symbols, market)
                continue

            if op == "unsubscribe":
                symbols = _symbols_from_payload(payload)
                await websocket.send_json({"type": "unsubscribed", "symbols": symbols, "channels": ["depth"]})
                continue

            await websocket.send_json({"type": "error", "message": f"Unsupported op: {op or 'unknown'}"})
    except WebSocketDisconnect:
        logger.debug("WS depth client disconnected")
    except Exception as exc:
        logger.exception("WS depth error: %s", exc)
        try:
            await websocket.send_json({"type": "error", "message": "Internal server error"})
        except Exception:
            pass
