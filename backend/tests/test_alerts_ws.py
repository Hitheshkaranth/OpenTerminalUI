from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import stream as stream_routes


def _ws_auth(monkeypatch) -> dict[str, str]:  # noqa: ANN001
    """WebSockets require an access token (SEC-2)."""
    from backend.auth.jwt import create_access_token

    monkeypatch.setenv("JWT_SECRET_KEY", "ws-test-secret-key-0123456789abcdef")
    return {"Authorization": f"Bearer {create_access_token('ws-test-user', 'ws@example.com', 'trader')}"}


class _FakeHub:
    def __init__(self) -> None:
        self.register_count = 0
        self.unregister_count = 0

    async def start(self) -> None:
        pass

    async def register_alert_socket(self, websocket) -> None:  # noqa: ANN001
        self.register_count += 1

    async def unregister_alert_socket(self, websocket) -> None:  # noqa: ANN001
        self.unregister_count += 1


def test_ws_alerts_ping_and_ignores_non_ping(monkeypatch) -> None:
    hub = _FakeHub()
    monkeypatch.setattr(stream_routes, "get_marketdata_hub", lambda: hub)

    test_app = FastAPI()
    test_app.include_router(stream_routes.router)

    with TestClient(test_app) as client:
        with client.websocket_connect("/ws/alerts", headers=_ws_auth(monkeypatch)) as ws:
            ws.send_json({"op": "ping"})
            assert ws.receive_json() == {"type": "pong"}

            ws.send_json({"op": "subscribe", "channels": ["alerts"]})

    assert hub.register_count == 1
    assert hub.unregister_count == 1
