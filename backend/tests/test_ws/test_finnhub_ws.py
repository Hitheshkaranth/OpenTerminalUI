from __future__ import annotations

import asyncio
import json
import sys

from backend.services.finnhub_ws import FinnhubWebSocket


class _SendOnlySocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    async def send(self, payload: str) -> None:
        self.sent.append(json.loads(payload))


class _IterableSocket(_SendOnlySocket):
    def __init__(self, rows: list[str]) -> None:
        super().__init__()
        self._rows = list(rows)

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        if not self._rows:
            raise StopAsyncIteration
        return self._rows.pop(0)


def test_finnhub_ws_disabled_without_key(monkeypatch) -> None:
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.setenv("FINNHUB_WS_ENABLED", "true")

    client = FinnhubWebSocket(lambda *_: None)
    assert client.enabled is False
    assert client.connected is False

    asyncio.run(client.start())
    assert client.connected is False


def test_finnhub_ws_set_symbols_flushes_subscriptions(monkeypatch) -> None:
    monkeypatch.setenv("FINNHUB_API_KEY", "demo-key")
    monkeypatch.setenv("FINNHUB_WS_ENABLED", "true")

    client = FinnhubWebSocket(lambda *_: None)
    socket = _SendOnlySocket()
    client._ws = socket  # noqa: SLF001
    client._connected = True  # noqa: SLF001
    client._sent_symbols = {"MSFT"}  # noqa: SLF001

    asyncio.run(client.set_symbols({"AAPL"}))

    assert socket.sent == [
        {"type": "unsubscribe", "symbol": "MSFT"},
        {"type": "subscribe", "symbol": "AAPL"},
    ]
    assert client._sent_symbols == {"AAPL"}  # noqa: SLF001


def test_finnhub_ws_listen_loop_dispatches_trade_and_reconnect(monkeypatch) -> None:
    monkeypatch.setenv("FINNHUB_API_KEY", "demo-key")
    monkeypatch.setenv("FINNHUB_WS_ENABLED", "true")

    seen: list[tuple[str, float, float, int]] = []
    reconnect_called = {"value": False}

    async def _on_trade(symbol: str, price: float, volume: float, ts_ms: int) -> None:
        seen.append((symbol, price, volume, ts_ms))

    async def _reconnect_stub() -> None:
        reconnect_called["value"] = True

    client = FinnhubWebSocket(_on_trade)
    client._ws = _IterableSocket(  # noqa: SLF001
        ['{"type":"trade","data":[{"s":"AAPL","p":210.5,"v":4,"t":1700000000123}]}']
    )
    client._running = True  # noqa: SLF001
    monkeypatch.setattr(client, "_reconnect_later", _reconnect_stub)

    asyncio.run(client._listen_loop())  # noqa: SLF001

    assert seen == [("AAPL", 210.5, 4.0, 1700000000123)]
    assert reconnect_called["value"] is True
    assert client.connected is False


def test_finnhub_ws_auth_failure_disables_session(monkeypatch) -> None:
    monkeypatch.setenv("FINNHUB_API_KEY", "bad-key")
    monkeypatch.setenv("FINNHUB_WS_ENABLED", "true")

    class _FakeWebsockets:
        @staticmethod
        async def connect(*_args, **_kwargs):
            raise RuntimeError("401 unauthorized")

    monkeypatch.setitem(sys.modules, "websockets", _FakeWebsockets)

    client = FinnhubWebSocket(lambda *_: None)
    asyncio.run(client.start())

    assert client.enabled is False
    assert client.connected is False
    assert client._running is False  # noqa: SLF001
