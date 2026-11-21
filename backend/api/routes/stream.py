from __future__ import annotations

import logging
import os
import secrets
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import jwt
from jwt import PyJWTError as JWTError

from backend.services.marketdata_hub import get_marketdata_hub
from backend.services.orderbook_service import service as orderbook_service
from backend.services.us_tick_stream import get_us_tick_stream_service
from backend.config.security import get_jwt_secret, is_development_env
from backend.config.settings import _default_cors_origins, _parse_cors_env, get_settings

try:  # Contract C1 helper (W1); fall back to the same rule deps.py applies.
    from backend.config.security import dev_auth_bypass_enabled as _dev_auth_bypass_enabled
except ImportError:  # pragma: no cover - only hit if security.py predates the helper
    def _dev_auth_bypass_enabled() -> bool:
        return is_development_env() and os.getenv("E2E_DEV_AUTH", "").strip() == "1"

router = APIRouter()
logger = logging.getLogger(__name__)
service = orderbook_service

# Close code sent after accept() when a socket fails authentication, so browser
# clients can tell "auth failed" apart from a network drop (1006).
WS_CLOSE_UNAUTHORIZED = 4401
_DEV_USER_ID = "dev-user"
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _ws_allowed_origins() -> set[str]:
    """Origins allowed to open a WebSocket, derived from the configured CORS origins.

    An explicitly configured OPENTERMINALUI_CORS_ORIGINS is honoured as-is. The
    built-in localhost defaults only apply in development environments.
    """
    configured = _parse_cors_env(os.getenv("OPENTERMINALUI_CORS_ORIGINS"))
    if configured is not None:
        origins = configured
    else:
        origins = list(get_settings().cors_origins or [])
        if not is_development_env():
            defaults = set(_default_cors_origins())
            origins = [o for o in origins if o not in defaults]
    return {o.strip().rstrip("/") for o in origins if o and o.strip()}


def _validate_ws_origin(header: str | None, host: str | None = None) -> bool:
    """Check that the WebSocket Origin header is allowed.

    A missing Origin is allowed. This check defends against cross-site WebSocket
    hijacking, which only a browser can be tricked into, and browsers always send
    Origin on the handshake. Non-browser clients (scripts, CLIs, the test suite)
    send none, and a non-browser attacker can spoof the header anyway, so rejecting
    headerless clients breaks them without adding protection. Every socket must
    still present a valid access token.
    """
    if header is None:
        return True
    if not header.strip():
        return False
    origin = header.strip().rstrip("/")
    allowed = _ws_allowed_origins()
    if "*" in allowed or origin in allowed:
        return True
    try:
        from urllib.parse import urlparse

        parsed = urlparse(origin)
        # Same-origin (frontend served by the same host as the API) is never cross-site.
        if host and parsed.netloc and parsed.netloc.lower() == host.strip().lower():
            return True
        # Any localhost port is only acceptable for local development.
        if is_development_env() and parsed.hostname in _LOCAL_HOSTS:
            return True
    except Exception:
        pass
    return False


def _validate_ws_jwt(token: str) -> dict | None:
    """Validate a JWT from a query param or header, return payload or None."""
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=["HS256"], options={"require": ["exp", "sub", "type"]})
        if str(payload.get("type", "")) == "access" and str(payload.get("sub") or "").strip():
            return payload
    except (JWTError, Exception):
        pass
    return None


def _ws_token(websocket: WebSocket) -> str | None:
    query_params = websocket.query_params
    candidate = query_params.get("token") or query_params.get("access_token")
    if candidate:
        return candidate.strip() or None
    auth_header = websocket.headers.get("authorization") or websocket.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip() or None
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


async def _reject_unauthorized(websocket: WebSocket, reason: str) -> None:
    # Accept first so the 4401 close code reaches the client (a pre-accept close
    # surfaces as an opaque HTTP 403 / code 1006 in browsers).
    try:
        await websocket.accept()
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason=reason)
    except Exception:
        pass


async def _authenticate_ws(websocket: WebSocket) -> str | None:
    """Validate the Origin header and the access token on a WebSocket handshake.

    Returns the authenticated user id (bound to ``websocket.state.user_id``), or
    None after closing the socket. A token is required on every endpoint unless the
    development-only E2E auth bypass is active.
    """
    origin = websocket.headers.get("origin") or websocket.headers.get("Origin")
    if not _validate_ws_origin(origin, websocket.headers.get("host")):
        try:
            await websocket.close(code=1008, reason="Origin not allowed")
        except Exception:
            pass
        return None

    token = _ws_token(websocket)
    payload = _validate_ws_jwt(token) if token else None
    if payload is not None:
        user_id = str(payload.get("sub")).strip()
    elif _dev_auth_bypass_enabled():
        # e2e dev-auth sends unsigned tokens; mirror get_current_user's dev user.
        user_id = _DEV_USER_ID
    else:
        await _reject_unauthorized(websocket, "Invalid or expired token" if token else "Missing access token")
        return None

    try:
        websocket.state.user_id = user_id
    except Exception:
        pass
    return user_id


async def _send_depth_snapshots(
    websocket: WebSocket, symbols: list[str], market: str, levels: int = 10, ref_price: float | None = None
) -> None:
    for symbol in symbols:
        # ref_price only applies to a single-symbol subscription (it is that symbol's real last price).
        ref = ref_price if len(symbols) == 1 else None
        snapshot = service.stream_message(symbol, market_hint=market, levels=levels, ref_price=ref)
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
            if isinstance(payload, dict) and str(payload.get("op") or "").strip().lower() == "ping":
                await websocket.send_json({"type": "pong"})
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
                try:
                    ref_price = float(payload.get("ref_price")) if payload.get("ref_price") is not None else None
                except (TypeError, ValueError):
                    ref_price = None
                await _send_depth_snapshots(websocket, symbols, market, ref_price=ref_price if ref_price and ref_price > 0 else None)
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
