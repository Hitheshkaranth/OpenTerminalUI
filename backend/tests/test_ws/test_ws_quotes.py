from __future__ import annotations

from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient

from backend.api.routes import stream


def _ws_auth(monkeypatch) -> dict[str, str]:  # noqa: ANN001
    """WebSockets require an access token (SEC-2)."""
    from backend.auth.jwt import create_access_token

    monkeypatch.setenv("JWT_SECRET_KEY", "ws-test-secret-key-0123456789abcdef")
    return {"Authorization": f"Bearer {create_access_token('ws-test-user', 'ws@example.com', 'trader')}"}


def test_ws_quotes_route_registered() -> None:
    assert stream.router is not None


class _FakeMarketDataHub:
    def __init__(self) -> None:
        self.registered: list[WebSocket] = []
        self.unregistered: list[WebSocket] = []
        self.subscriptions: list[list[str]] = []

    async def register(self, websocket: WebSocket) -> None:
        self.registered.append(websocket)

    async def unregister(self, websocket: WebSocket) -> None:
        self.unregistered.append(websocket)

    async def subscribe(self, websocket: WebSocket, symbols: list[str]) -> list[str]:
        self.subscriptions.append(list(symbols))
        await websocket.send_json(
            {
                "type": "tick",
                "symbol": "NSE:INFY",
                "ltp": 100.75,
                "change": 1.25,
                "change_pct": 1.26,
                "oi": None,
                "volume": 1000.0,
                "ts": "2026-02-28T10:00:00+00:00",
                "provider": "kite",
            }
        )
        await websocket.send_json(
            {
                "type": "candle",
                "symbol": "NSE:INFY",
                "interval": "1m",
                "status": "partial",
                "t": 1772272800000,
                "o": 100.0,
                "h": 101.0,
                "l": 99.8,
                "c": 100.75,
                "v": 1200.0,
            }
        )
        return list(symbols)

    async def unsubscribe(self, websocket: WebSocket, symbols: list[str]) -> list[str]:
        return list(symbols)


def test_ws_quotes_subscribe_receives_tick_and_candle(monkeypatch) -> None:
    app = FastAPI()
    app.include_router(stream.router)
    fake_hub = _FakeMarketDataHub()
    monkeypatch.setattr(stream, "get_marketdata_hub", lambda: fake_hub)

    with TestClient(app) as client:
        with client.websocket_connect("/ws/quotes", headers=_ws_auth(monkeypatch)) as ws:
            ws.send_json({"op": "subscribe", "symbols": ["nse:infy"]})
            tick = ws.receive_json()
            candle = ws.receive_json()

            assert tick == {
                "type": "tick",
                "symbol": "NSE:INFY",
                "ltp": 100.75,
                "change": 1.25,
                "change_pct": 1.26,
                "oi": None,
                "volume": 1000.0,
                "ts": "2026-02-28T10:00:00+00:00",
                "provider": "kite",
            }
            assert candle["type"] == "candle"
            assert candle["symbol"] == "NSE:INFY"
            assert candle["interval"] in {"1m", "5m", "15m"}
            assert candle["status"] in {"partial", "closed"}
            assert {"t", "o", "h", "l", "c", "v"}.issubset(set(candle.keys()))

    assert len(fake_hub.registered) == 1
    assert len(fake_hub.unregistered) == 1
    assert fake_hub.subscriptions == [["NSE:INFY"]]
