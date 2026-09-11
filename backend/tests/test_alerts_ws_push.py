from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import stream as stream_routes


class _FakeHub:
    def __init__(self) -> None:
        self.alert_connections: set = set()
        self.register_count = 0
        self.unregister_count = 0
        self.broadcast_payloads: list = []

    async def start(self) -> None:
        pass

    async def register_alert_socket(self, websocket) -> None:  # noqa: ANN001
        self.register_count += 1
        self.alert_connections.add(websocket)

    async def unregister_alert_socket(self, websocket) -> None:  # noqa: ANN001
        self.unregister_count += 1
        self.alert_connections.discard(websocket)

    async def broadcast_alert(self, payload) -> None:  # noqa: ANN001
        self.broadcast_payloads.append(payload)
        for ws in list(self.alert_connections):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

    async def register_tick_listener(self, listener) -> None:
        pass

    def unregister_tick_listener(self, listener) -> None:
        pass

    async def register(self, websocket) -> None:
        pass

    async def unregister(self, websocket) -> None:
        pass

    def broadcast(self, *args, **kwargs) -> None:  # noqa: ANN001, ANN003
        pass


def test_ws_alerts_ping(monkeypatch) -> None:
    hub = _FakeHub()
    monkeypatch.setattr(stream_routes, "get_marketdata_hub", lambda: hub)

    test_app = FastAPI()
    test_app.include_router(stream_routes.router)

    with TestClient(test_app) as client:
        with client.websocket_connect("/ws/alerts") as ws:
            ws.send_json({"op": "ping"})
            assert ws.receive_json() == {"type": "pong"}

    assert hub.register_count == 1
    assert hub.unregister_count == 1


def test_ws_alerts_silently_ignores_non_ping(monkeypatch) -> None:
    hub = _FakeHub()
    monkeypatch.setattr(stream_routes, "get_marketdata_hub", lambda: hub)

    test_app = FastAPI()
    test_app.include_router(stream_routes.router)

    with TestClient(test_app) as client:
        with client.websocket_connect("/ws/alerts") as ws:
            ws.send_json({"op": "subscribe", "channels": ["alerts"]})

            ws.send_json({"op": "ping"})
            assert ws.receive_json() == {"type": "pong"}

    assert hub.register_count == 1
    assert hub.unregister_count == 1


def test_ws_alerts_broadcast_payload_stored(monkeypatch) -> None:
    hub = _FakeHub()
    monkeypatch.setattr(stream_routes, "get_marketdata_hub", lambda: hub)

    async def _run() -> None:
        payload = {"type": "alert_triggered", "alert_id": "test-1", "symbol": "RELIANCE"}
        await hub.broadcast_alert(payload)
        assert len(hub.broadcast_payloads) == 1
        assert hub.broadcast_payloads[0] == payload

    asyncio.run(_run())


def test_ws_alerts_broadcast_reaches_connected_sockets(monkeypatch) -> None:
    hub = _FakeHub()
    monkeypatch.setattr(stream_routes, "get_marketdata_hub", lambda: hub)

    async def _run() -> None:
        received: list = []

        class _FakeSocket:
            def __init__(self) -> None:
                self._received: list = []

            async def send_json(self, payload) -> None:  # noqa: ANN001
                self._received.append(payload)

            def receive_json(self, *a, **k) -> None:
                pass

        ws1 = _FakeSocket()
        ws2 = _FakeSocket()
        await hub.register_alert_socket(ws1)
        await hub.register_alert_socket(ws2)

        payload = {"type": "alert_triggered", "alert_id": "test-2", "symbol": "TCS"}
        await hub.broadcast_alert(payload)

        assert len(ws1._received) == 1
        assert ws1._received[0] == payload
        assert len(ws2._received) == 1
        assert ws2._received[0] == payload

    asyncio.run(_run())