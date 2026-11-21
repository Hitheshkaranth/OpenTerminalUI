from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.api.routes import stream as stream_routes
from backend.services.marketdata_hub import MarketDataHub
from backend.services.redis_quote_bus import RedisQuoteBus


@pytest.fixture(autouse=True)
def _secure_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "w2-test-secret-key-0123456789abcdef")
    monkeypatch.setenv("OPENTERMINALUI_ENV", "production")
    monkeypatch.delenv("E2E_DEV_AUTH", raising=False)
    monkeypatch.delenv("OPENTERMINALUI_CORS_ORIGINS", raising=False)


def _token(sub: str = "user-a") -> str:
    from backend.auth.jwt import create_access_token

    return create_access_token(sub, f"{sub}@example.com", "trader")


class _FakeSocket:
    def __init__(self, user_id: str | None = None, delay: float = 0.0, fail: bool = False) -> None:
        self.state = SimpleNamespace(user_id=user_id)
        self.delay = delay
        self.fail = fail
        self.received: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        if self.fail:
            raise RuntimeError("socket closed")
        if self.delay:
            await asyncio.sleep(self.delay)
        self.received.append(payload)

    async def close(self) -> None:
        return None


async def _noop(*_a, **_k):
    return None


def _hub() -> MarketDataHub:
    hub = MarketDataHub()
    hub.start = _noop  # type: ignore[method-assign]
    hub._sync_stream_subscriptions = _noop  # type: ignore[method-assign]  # noqa: SLF001
    return hub


async def _drain(hub: MarketDataHub, timeout: float = 1.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if all(ch.queue.empty() for ch in hub._clients.values()):  # noqa: SLF001
            await asyncio.sleep(0.01)
            return
        await asyncio.sleep(0.005)


class _RouteHub:
    def __init__(self) -> None:
        self.registered: list = []

    async def register(self, websocket) -> None:  # noqa: ANN001
        self.registered.append(getattr(websocket.state, "user_id", None))

    async def unregister(self, websocket) -> None:  # noqa: ANN001
        pass

    async def register_alert_socket(self, websocket) -> None:  # noqa: ANN001
        self.registered.append(getattr(websocket.state, "user_id", None))

    async def unregister_alert_socket(self, websocket) -> None:  # noqa: ANN001
        pass


def _app(monkeypatch) -> tuple[FastAPI, _RouteHub]:
    hub = _RouteHub()
    monkeypatch.setattr(stream_routes, "get_marketdata_hub", lambda: hub)
    app = FastAPI()
    app.include_router(stream_routes.router)
    return app, hub


@pytest.mark.parametrize("path", ["/ws/quotes", "/ws/alerts", "/ws/us-quotes", "/ws/depth"])
def test_unauthenticated_ws_rejected_with_4401(monkeypatch, path) -> None:
    app, hub = _app(monkeypatch)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(path) as ws:
                ws.receive_json()
        assert exc.value.code == 4401
    assert hub.registered == []


def test_invalid_token_rejected_with_4401(monkeypatch) -> None:
    app, _ = _app(monkeypatch)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect("/ws/alerts?token=not-a-jwt") as ws:
                ws.receive_json()
        assert exc.value.code == 4401


def test_valid_token_binds_user_id(monkeypatch) -> None:
    app, hub = _app(monkeypatch)
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/alerts?token={_token('user-a')}") as ws:
            ws.send_json({"op": "ping"})
            assert ws.receive_json() == {"type": "pong"}
    assert hub.registered == ["user-a"]


def test_dev_bypass_allows_tokenless_socket_only_in_dev(monkeypatch) -> None:
    monkeypatch.setenv("E2E_DEV_AUTH", "1")
    app, hub = _app(monkeypatch)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws/alerts") as ws:
                ws.receive_json()
    monkeypatch.setenv("OPENTERMINALUI_ENV", "development")
    with TestClient(app) as client:
        with client.websocket_connect("/ws/alerts") as ws:
            ws.send_json({"op": "ping"})
            assert ws.receive_json() == {"type": "pong"}
    assert hub.registered == ["dev-user"]


def test_origin_allowlist_derives_from_cors(monkeypatch) -> None:
    v = stream_routes._validate_ws_origin  # noqa: SLF001
    # production, defaults only: localhost dev origins are not allowed
    assert v("http://localhost:5173") is False
    assert v("http://evil.example") is False
    assert v(None) is True
    # same-origin deployment
    assert v("https://app.example.com", "app.example.com") is True
    monkeypatch.setenv("OPENTERMINALUI_CORS_ORIGINS", "https://terminal.example.com")
    assert v("https://terminal.example.com") is True
    assert v("http://localhost:9999") is False
    monkeypatch.delenv("OPENTERMINALUI_CORS_ORIGINS")
    monkeypatch.setenv("OPENTERMINALUI_ENV", "development")
    assert v("http://localhost:5173") is True
    assert v("http://127.0.0.1:4321") is True
    assert v("http://evil.example") is False


def test_user_alert_isolated_and_system_alert_reaches_all() -> None:
    async def _run() -> None:
        hub = _hub()
        a, b = _FakeSocket("user-a"), _FakeSocket("user-b")
        await hub.register_alert_socket(a)
        await hub.register_alert_socket(b)

        await hub.broadcast_alert({"type": "alert_triggered", "alert_id": "1", "user_id": "user-a"})
        await hub.broadcast_alert({"type": "alert_triggered", "alert_id": "2", "user_id": None})
        await hub.broadcast_alert({"type": "data_quality", "alert_id": "3"})
        await _drain(hub)

        assert [m["alert_id"] for m in a.received] == ["1", "2", "3"]
        assert [m["alert_id"] for m in b.received] == ["2", "3"]
        await hub.shutdown()

    asyncio.run(_run())


def test_send_to_user_targets_only_that_user() -> None:
    async def _run() -> None:
        hub = _hub()
        a_quotes, a_alerts, b_quotes = _FakeSocket("user-a"), _FakeSocket("user-a"), _FakeSocket("user-b")
        await hub.register(a_quotes)
        await hub.register_alert_socket(a_alerts)
        await hub.register(b_quotes)

        await hub.send_to_user("user-a", {"type": "backtest_progress", "progress": 50})
        await _drain(hub)

        assert a_quotes.received == [{"type": "backtest_progress", "progress": 50}]
        assert a_alerts.received == [{"type": "backtest_progress", "progress": 50}]
        assert b_quotes.received == []
        await hub.shutdown()

    asyncio.run(_run())


def test_slow_client_does_not_block_fast_client() -> None:
    async def _run() -> None:
        hub = _hub()
        slow, fast = _FakeSocket("s", delay=5.0), _FakeSocket("f")
        await hub.register(slow)
        await hub.register(fast)
        await hub.subscribe(slow, ["NSE:INFY"])
        await hub.subscribe(fast, ["NSE:INFY"])

        started = time.monotonic()
        for i in range(600):
            await hub.broadcast("NSE:INFY", {"type": "tick", "symbol": "NSE:INFY", "seq": i})
            await asyncio.sleep(0)  # let writers run, as a real tick stream would
        assert time.monotonic() - started < 1.0  # producers never await the socket

        await _drain_fast(fast, 600)
        assert len(fast.received) == 600
        assert hub._clients[slow].dropped > 0  # noqa: SLF001  bounded queue dropped oldest
        assert hub._clients[slow].queue.qsize() <= 500  # noqa: SLF001

        await asyncio.wait_for(hub.shutdown(), timeout=2.0)  # cancels the stuck writer
        assert hub._clients == {}  # noqa: SLF001

    async def _drain_fast(sock: _FakeSocket, n: int) -> None:
        deadline = time.monotonic() + 2.0
        while len(sock.received) < n and time.monotonic() < deadline:
            await asyncio.sleep(0.01)

    asyncio.run(_run())


def test_failed_socket_is_dropped() -> None:
    async def _run() -> None:
        hub = _hub()
        dead = _FakeSocket("x", fail=True)
        await hub.register(dead)
        await hub.subscribe(dead, ["NSE:INFY"])
        await hub.broadcast("NSE:INFY", {"type": "tick"})
        for _ in range(50):
            if dead not in hub._connections:  # noqa: SLF001
                break
            await asyncio.sleep(0.01)
        assert dead not in hub._connections  # noqa: SLF001
        await hub.shutdown()

    asyncio.run(_run())


def test_symbol_caps(monkeypatch) -> None:
    monkeypatch.setenv("WS_MAX_SYMBOLS_PER_CONN", "2")
    monkeypatch.setenv("WS_MAX_TOTAL_SYMBOLS", "3")

    async def _run() -> None:
        hub = _hub()
        a, b = _FakeSocket("a"), _FakeSocket("b")
        await hub.register(a)
        await hub.register(b)

        accepted = await hub.subscribe(a, ["NSE:INFY", "NSE:TCS", "NSE:SBIN"])
        assert accepted == ["NSE:INFY", "NSE:TCS"]
        # re-subscribing an existing symbol is not counted again
        assert await hub.subscribe(a, ["NSE:INFY"]) == ["NSE:INFY"]

        # hub-wide cap: 2 used, 1 slot left; a symbol already in the hub is free
        accepted_b = await hub.subscribe(b, ["NSE:INFY", "NSE:HDFC", "NSE:WIPRO"])
        assert accepted_b == ["NSE:INFY", "NSE:HDFC"]
        await _drain(hub)

        errors_a = [m for m in a.received if m.get("type") == "error"]
        errors_b = [m for m in b.received if m.get("type") == "error"]
        assert errors_a and errors_a[0]["rejected"] == ["NSE:SBIN"]
        assert errors_b and errors_b[0]["rejected"] == ["NSE:WIPRO"]
        await hub.shutdown()

    asyncio.run(_run())


def test_partial_candles_throttled_per_symbol_interval() -> None:
    async def _run() -> None:
        hub = _hub()
        sent: list[dict] = []

        async def _capture(symbol, payload):  # noqa: ANN001
            sent.append(payload)

        hub.broadcast = _capture  # type: ignore[method-assign]
        for i in range(20):
            await hub._on_tick_for_candles(  # noqa: SLF001
                {"symbol": "NSE:INFY", "ltp": 100.0 + i, "volume": 1, "ts": "2026-02-24T09:15:05+00:00"}
            )
        partials = [p for p in sent if p.get("status") == "partial"]
        intervals = {p["interval"] for p in partials}
        # one partial per interval despite 20 ticks within a second
        assert len(partials) == len(intervals)

    asyncio.run(_run())


def test_scanner_alert_carries_owner_user_id() -> None:
    from backend.alerts import scanner_rules

    row = SimpleNamespace(
        id="r1", user_id="owner-1", preset_id="p", symbol="NSE:INFY", setup_type="breakout",
        enabled=True, last_event_at=None, dedupe_minutes=15, trigger_level=100.0,
        invalidation_level=None, near_trigger_pct=0.003, last_event_type=None, updated_at=None,
    )

    class _Q:
        def filter(self, *a, **k):  # noqa: ANN002, ANN003
            return self

        def all(self):
            return [row]

    db = SimpleNamespace(query=lambda *_a: _Q(), commit=lambda: None)
    captured: list[dict] = []

    class _Hub:
        async def broadcast_alert(self, payload):  # noqa: ANN001
            captured.append(payload)

    asyncio.run(scanner_rules.process_scanner_tick(db, _Hub(), {"symbol": "NSE:INFY", "ltp": 101.0}))
    assert captured and captured[0]["user_id"] == "owner-1"


def test_redis_bus_inbox_drops_oldest_and_consumer_emits() -> None:
    async def _run() -> None:
        bus = RedisQuoteBus()
        bus._inbox = asyncio.Queue(maxsize=3)  # noqa: SLF001
        for i in range(5):
            bus._enqueue("quotes:nse", {"seq": i})  # noqa: SLF001
        assert bus.dropped_messages == 2

        got: list[int] = []

        async def _listener(channel, payload):  # noqa: ANN001
            got.append(payload["seq"])

        bus.register_local_listener(_listener)
        task = asyncio.create_task(bus._consume_loop())  # noqa: SLF001
        for _ in range(50):
            if len(got) == 3:
                break
            await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert got == [2, 3, 4]

    asyncio.run(_run())
