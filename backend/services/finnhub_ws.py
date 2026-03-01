from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)


class FinnhubWebSocket:
    WS_URL = "wss://ws.finnhub.io?token={token}"

    def __init__(self, on_trade: Callable[[str, float, float, int], Awaitable[None] | None]) -> None:
        self.api_key = os.getenv("FINNHUB_API_KEY", "").strip()
        self.enabled = (os.getenv("FINNHUB_WS_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}) and bool(self.api_key)
        self._on_trade = on_trade
        self._ws: Any = None
        self._listen_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._desired_symbols: set[str] = set()
        self._sent_symbols: set[str] = set()
        self._running = False
        self._connected = False
        self._auth_failed = False

    @property
    def connected(self) -> bool:
        return self._connected

    async def start(self) -> None:
        if not self.enabled:
            return
        async with self._lock:
            if self._running:
                return
            self._running = True
        await self._connect()

    async def stop(self) -> None:
        async with self._lock:
            self._running = False
            task = self._listen_task
            self._listen_task = None
            ws = self._ws
            self._ws = None
            self._connected = False
            self._sent_symbols.clear()
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        if ws:
            try:
                await ws.close()
            except Exception:
                pass

    async def set_symbols(self, symbols: set[str]) -> None:
        async with self._lock:
            self._desired_symbols = {s.strip().upper() for s in symbols if s and s.strip()}
            ws = self._ws
            connected = self._connected
        if ws and connected:
            await self._flush_subscriptions()

    async def _connect(self) -> None:
        if not self.enabled:
            return
        try:
            import websockets  # type: ignore
        except Exception as exc:
            logger.warning("Finnhub WS disabled: websockets unavailable (%s)", exc)
            self.enabled = False
            return

        url = self.WS_URL.format(token=self.api_key)
        try:
            ws = await websockets.connect(url, ping_interval=20, ping_timeout=20)
        except Exception as exc:
            msg = str(exc)
            if "401" in msg or "403" in msg:
                if not self._auth_failed:
                    logger.warning("Finnhub WS disabled for this session due to auth failure: %s", exc)
                self._auth_failed = True
                self.enabled = False
                async with self._lock:
                    self._running = False
                return
            logger.warning("Finnhub WS connect failed: %s", exc)
            async with self._lock:
                if self._running:
                    asyncio.create_task(self._reconnect_later())
            return

        async with self._lock:
            self._ws = ws
            self._connected = True
            self._sent_symbols.clear()
            self._listen_task = asyncio.create_task(self._listen_loop(), name="finnhub-ws-listen")
        await self._flush_subscriptions()
        logger.info("Finnhub WS connected")

    async def _reconnect_later(self) -> None:
        await asyncio.sleep(5)
        async with self._lock:
            if not self._running:
                return
        await self._connect()

    async def _flush_subscriptions(self) -> None:
        async with self._lock:
            ws = self._ws
            if not ws or not self._connected:
                return
            desired = set(self._desired_symbols)
            sent = set(self._sent_symbols)
        to_sub = sorted(desired - sent)
        to_unsub = sorted(sent - desired)
        applied = set(sent)
        for sym in to_unsub:
            try:
                await ws.send(json.dumps({"type": "unsubscribe", "symbol": sym}))
                applied.discard(sym)
            except Exception:
                break
        for sym in to_sub:
            try:
                await ws.send(json.dumps({"type": "subscribe", "symbol": sym}))
                applied.add(sym)
            except Exception:
                break
        async with self._lock:
            # Keep local subscription bookkeeping aligned with what we actually sent.
            self._sent_symbols = applied

    async def _listen_loop(self) -> None:
        ws = self._ws
        if not ws:
            return
        try:
            async for raw in ws:
                try:
                    payload = json.loads(raw)
                except Exception:
                    continue
                if not isinstance(payload, dict):
                    continue
                if payload.get("type") != "trade":
                    continue
                trades = payload.get("data")
                if not isinstance(trades, list):
                    continue
                for trade in trades:
                    if not isinstance(trade, dict):
                        continue
                    sym = str(trade.get("s") or "").strip().upper()
                    try:
                        price = float(trade.get("p"))
                    except Exception:
                        continue
                    vol = float(trade.get("v") or 0)
                    try:
                        ts_ms = int(trade.get("t"))
                    except Exception:
                        ts_ms = 0
                    if not sym or ts_ms <= 0:
                        continue
                    result = self._on_trade(sym, price, vol, ts_ms)
                    if asyncio.iscoroutine(result):
                        await result
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Finnhub WS listen loop failed: %s", exc)
        finally:
            async with self._lock:
                self._connected = False
                self._ws = None
                self._sent_symbols.clear()
                running = self._running
            if running:
                await self._reconnect_later()
