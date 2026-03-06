from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app
from backend.api.routes import stream as stream_routes


class _FakeHub:
    def __init__(self) -> None:
        self.register_count = 0
        self.unregister_count = 0

    async def register_alert_socket(self, websocket) -> None:  # noqa: ANN001
        self.register_count += 1

    async def unregister_alert_socket(self, websocket) -> None:  # noqa: ANN001
        self.unregister_count += 1


def test_ws_alerts_ping_and_push_only_info(monkeypatch) -> None:
    hub = _FakeHub()
    monkeypatch.setattr(stream_routes, "get_marketdata_hub", lambda: hub)

    with TestClient(app) as client:
        with client.websocket_connect("/api/ws/alerts") as ws:
            ws.send_json({"op": "ping"})
            assert ws.receive_json() == {"type": "pong"}

            ws.send_json({"op": "subscribe", "channels": ["alerts"]})
            assert ws.receive_json() == {"type": "info", "message": "alerts channel is push-only"}

    assert hub.register_count == 1
    assert hub.unregister_count == 1
