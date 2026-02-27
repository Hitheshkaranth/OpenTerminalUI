from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.services.marketdata_hub import get_marketdata_hub
from backend.services.us_tick_stream import get_us_tick_stream_service

router = APIRouter()
logger = logging.getLogger(__name__)


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


@router.websocket("/ws/quotes")
async def ws_quotes(websocket: WebSocket) -> None:
    hub = get_marketdata_hub()
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
