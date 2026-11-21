from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes import depth as depth_routes
from backend.api.routes import stream as stream_routes


def _ws_auth(monkeypatch) -> dict[str, str]:  # noqa: ANN001
    """WebSockets require an access token (SEC-2)."""
    from backend.auth.jwt import create_access_token

    monkeypatch.setenv("JWT_SECRET_KEY", "ws-test-secret-key-0123456789abcdef")
    return {"Authorization": f"Bearer {create_access_token('ws-test-user', 'ws@example.com', 'trader')}"}


class _FakeHub:
    def __init__(self) -> None:
        self.registered = False
        self.subscriptions: list[list[str]] = []

    async def register(self, websocket) -> None:  # noqa: ANN001 - test shim
        self.registered = True

    async def unregister(self, websocket) -> None:  # noqa: ANN001 - test shim
        self.registered = False

    async def subscribe(self, websocket, symbols):  # noqa: ANN001 - test shim
        self.subscriptions.append(list(symbols))
        return bool(symbols)

    async def unsubscribe(self, websocket, symbols):  # noqa: ANN001 - test shim
        return {"symbols": list(symbols)}

    async def register_alert_socket(self, websocket) -> None:  # noqa: ANN001 - test shim
        return None

    async def unregister_alert_socket(self, websocket) -> None:  # noqa: ANN001 - test shim
        return None


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(depth_routes.router, prefix="/api")
    app.include_router(stream_routes.router, prefix="/api")
    return app


def test_depth_snapshot_http_returns_sorted_book_and_provider_key() -> None:
    client = TestClient(_build_app())

    cases = [
        ("RELIANCE", "IN", "kite"),
        ("AAPL", "US", "finnhub"),
        ("BTC-USD", "CRYPTO", "binance"),
    ]
    for symbol, market, provider_key in cases:
        response = client.get(f"/api/depth/{symbol}", params={"market": market, "levels": 6})
        assert response.status_code == 200
        payload = response.json()
        assert payload["symbol"] == symbol
        assert payload["market"] == market
        assert payload["provider_key"] == provider_key
        assert payload["levels"] == 6
        bids = payload["bids"]
        asks = payload["asks"]
        assert len(bids) == 6
        assert len(asks) == 6
        assert bids == sorted(bids, key=lambda row: row["price"], reverse=True)
        assert asks == sorted(asks, key=lambda row: row["price"])
        assert payload["spread"] >= 0
        assert payload["total_bid_quantity"] > 0
        assert payload["total_ask_quantity"] > 0


def test_depth_websocket_emits_ready_subscribed_and_snapshot(monkeypatch) -> None:
    client = TestClient(_build_app())

    with client.websocket_connect("/api/ws/depth", headers=_ws_auth(monkeypatch)) as websocket:
        ready = websocket.receive_json()
        assert ready == {"type": "ready", "channels": ["depth"]}

        websocket.send_json({"op": "subscribe", "symbols": ["MSFT"], "market": "US"})
        subscribed = websocket.receive_json()
        assert subscribed["type"] == "subscribed"
        assert subscribed["symbols"] == ["MSFT"]
        assert subscribed["market"] == "US"

        depth_msg = websocket.receive_json()
        assert depth_msg["type"] == "depth"
        assert depth_msg["symbol"] == "MSFT"
        assert depth_msg["market"] == "US"
        assert depth_msg["snapshot"]["provider_key"] == "finnhub"
        assert depth_msg["snapshot"]["bids"][0]["price"] > depth_msg["snapshot"]["asks"][0]["price"] - 10_000


def test_quotes_websocket_can_emit_depth_channel_messages(monkeypatch) -> None:
    client = TestClient(_build_app())
    fake_hub = _FakeHub()
    monkeypatch.setattr(stream_routes, "get_marketdata_hub", lambda: fake_hub)

    with client.websocket_connect("/api/ws/quotes", headers=_ws_auth(monkeypatch)) as websocket:
        websocket.send_json({"op": "subscribe", "symbols": ["TCS"], "market": "IN", "channels": ["depth"]})
        depth_msg = websocket.receive_json()
        assert depth_msg["type"] == "depth"
        assert depth_msg["symbol"] == "TCS"
        assert depth_msg["market"] == "IN"
        assert depth_msg["provider_key"] == "kite"
