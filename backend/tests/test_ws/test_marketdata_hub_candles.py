from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from backend.services.marketdata_hub import MarketDataHub


def _iso(y: int, mo: int, d: int, h: int, mi: int, s: int) -> str:
    return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc).isoformat()


def test_marketdata_hub_emits_partial_and_closed_candles_from_tick_stream(monkeypatch) -> None:
    hub = MarketDataHub()
    broadcast_calls: list[tuple[str, dict]] = []

    async def _fake_broadcast(symbol: str, payload: dict) -> None:
        broadcast_calls.append((symbol, payload))

    monkeypatch.setattr(hub, "broadcast", _fake_broadcast)

    async def _run() -> None:
        # Directly exercise the hub's tick-listener pipeline (listeners include candle aggregation).
        await hub._emit_tick(
            {
                "type": "tick",
                "symbol": "NSE:INFY",
                "ltp": 100.0,
                "change": 0.0,
                "change_pct": 0.0,
                "oi": None,
                "volume": 10,
                "ts": _iso(2026, 2, 24, 9, 15, 5),
            }
        )
        await hub._emit_tick(
            {
                "type": "tick",
                "symbol": "NSE:INFY",
                "ltp": 101.0,
                "change": 1.0,
                "change_pct": 1.0,
                "oi": None,
                "volume": 5,
                "ts": _iso(2026, 2, 24, 9, 15, 40),
            }
        )
        # New minute should close the prior 1m candle and trigger a candle broadcast.
        await hub._emit_tick(
            {
                "type": "tick",
                "symbol": "NSE:INFY",
                "ltp": 102.0,
                "change": 2.0,
                "change_pct": 2.0,
                "oi": None,
                "volume": 7,
                "ts": _iso(2026, 2, 24, 9, 16, 0),
            }
        )

    asyncio.run(_run())

    candles = [payload for symbol, payload in broadcast_calls if symbol == "NSE:INFY" and payload.get("type") == "candle"]
    one_min = [payload for payload in candles if payload.get("interval") == "1m"]
    assert one_min, "expected at least one 1m candle broadcast"

    partials = [payload for payload in one_min if payload.get("status") == "partial"]
    closeds = [payload for payload in one_min if payload.get("status") == "closed"]

    assert partials, "expected intrabar partial candle updates"
    assert closeds, "expected closed candle update on rollover"

    closed = closeds[0]
    assert closed["symbol"] == "NSE:INFY"
    assert closed["o"] == 100.0
    assert closed["h"] == 101.0
    assert closed["l"] == 100.0
    assert closed["c"] == 101.0
    assert closed["v"] == 15.0


def test_marketdata_hub_finnhub_trade_publishes_us_ticks_for_subscribers() -> None:
    hub = MarketDataHub()
    published: list[tuple[str, dict]] = []

    async def _fake_publish_tick(market: str, payload: dict) -> None:
        published.append((market, payload))

    hub._bus.publish_tick = _fake_publish_tick  # noqa: SLF001

    class _WS:
        pass

    ws = _WS()

    async def _run() -> None:
        async with hub._lock:  # noqa: SLF001
            hub._connections[ws] = {"NASDAQ:AAPL", "NYSE:AAPL"}  # noqa: SLF001
        await hub._on_finnhub_trade("AAPL", 195.25, 10.0, 1700000000000)  # noqa: SLF001

    asyncio.run(_run())

    assert [row[0] for row in published] == ["NASDAQ", "NYSE"]
    assert all(row[1]["provider"] == "finnhub" for row in published)
    assert all(row[1]["symbol"] in {"NASDAQ:AAPL", "NYSE:AAPL"} for row in published)
    assert all(row[1]["ltp"] == 195.25 for row in published)
