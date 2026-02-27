from __future__ import annotations

from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient

from backend.api.routes import stream


class _FakeUSTickStreamService:
    def __init__(self) -> None:
        self.registered: list[WebSocket] = []
        self.unregistered: list[WebSocket] = []
        self.subscriptions: list[dict[str, object]] = []
        self.unsubscriptions: list[dict[str, object]] = []

    async def register(self, websocket: WebSocket) -> None:
        self.registered.append(websocket)

    async def unregister(self, websocket: WebSocket) -> None:
        self.unregistered.append(websocket)

    async def subscribe(self, websocket: WebSocket, symbols: list[str], channels: list[str] | None = None) -> dict[str, object]:
        self.subscriptions.append({"symbols": list(symbols), "channels": list(channels or [])})
        # Simulate provider stream payloads + backfill before endpoint sends subscribed ack.
        await websocket.send_json(
            {
                "type": "backfill",
                "symbol": "AAPL",
                "interval": "1m",
                "provider": "alpaca",
                "bars": [
                    {
                        "t": 1700000000000,
                        "o": 100.0,
                        "h": 101.0,
                        "l": 99.5,
                        "c": 100.5,
                        "v": 1000.0,
                        "vwap": 100.2,
                        "s": "regular",
                        "ext": False,
                    }
                ],
            }
        )
        await websocket.send_json(
            {
                "type": "trade",
                "symbol": "AAPL",
                "p": 100.75,
                "v": 10.0,
                "t": 1700000005000,
                "ts": "2024-01-01T15:30:05+00:00",
                "provider": "alpaca",
                "latency_ms": 23.4,
            }
        )
        await websocket.send_json(
            {
                "type": "bar",
                "symbol": "AAPL",
                "interval": "1m",
                "status": "partial",
                "t": 1700000040000,
                "o": 100.5,
                "h": 101.2,
                "l": 100.4,
                "c": 101.1,
                "v": 55.0,
                "vwap": 100.94,
                "s": "regular",
                "ext": False,
                "ticks": 4,
                "provider": "alpaca",
            }
        )
        await websocket.send_json(
            {
                "type": "provider_health",
                "primary_provider": "alpaca",
                "providers": {
                    "alpaca": {"connected": True, "score": 98.0},
                    "finnhub": {"connected": True, "score": 91.0},
                },
            }
        )
        return {"symbols": ["AAPL"], "channels": ["bars", "trades"]}

    async def unsubscribe(self, websocket: WebSocket, symbols: list[str], channels: list[str] | None = None) -> dict[str, object]:
        self.unsubscriptions.append({"symbols": list(symbols), "channels": list(channels or [])})
        return {"symbols": list(symbols), "channels": list(channels or [])}


def test_ws_us_quotes_subscribe_emits_expected_frame_shapes(monkeypatch) -> None:
    app = FastAPI()
    app.include_router(stream.router)
    fake_service = _FakeUSTickStreamService()
    monkeypatch.setattr(stream, "get_us_tick_stream_service", lambda: fake_service)

    with TestClient(app) as client:
        with client.websocket_connect("/ws/us-quotes") as ws:
            ready = ws.receive_json()
            assert ready["type"] == "ready"
            assert set(ready["channels"]) == {"bars", "trades"}

            ws.send_json({"op": "subscribe", "symbols": ["AAPL"], "channels": ["bars", "trades"]})

            backfill = ws.receive_json()
            trade = ws.receive_json()
            bar = ws.receive_json()
            provider_health = ws.receive_json()
            subscribed = ws.receive_json()

            assert backfill["type"] == "backfill"
            assert backfill["symbol"] == "AAPL"
            assert backfill["interval"] == "1m"
            assert isinstance(backfill["bars"], list)
            assert backfill["bars"][0]["s"] == "regular"
            assert backfill["bars"][0]["ext"] is False

            assert trade["type"] == "trade"
            assert trade["symbol"] == "AAPL"
            assert isinstance(trade["p"], float)
            assert "provider" in trade
            assert "latency_ms" in trade

            assert bar["type"] == "bar"
            assert bar["interval"] == "1m"
            assert bar["status"] in {"partial", "closed"}
            assert {"o", "h", "l", "c", "v", "vwap", "s", "ext"}.issubset(set(bar.keys()))

            assert provider_health["type"] == "provider_health"
            assert provider_health["primary_provider"] == "alpaca"
            assert {"alpaca", "finnhub"}.issubset(set(provider_health["providers"].keys()))

            assert subscribed["type"] == "subscribed"
            assert set(subscribed["symbols"]) == {"AAPL"}
            assert set(subscribed["channels"]) == {"bars", "trades"}

        assert len(fake_service.registered) == 1
        assert len(fake_service.unregistered) == 1
        assert fake_service.subscriptions
