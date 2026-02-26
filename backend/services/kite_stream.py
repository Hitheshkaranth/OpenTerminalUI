from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Any, Callable

from backend.core.kite_client import KiteClient

logger = logging.getLogger(__name__)

TickHandler = Callable[[dict[str, Any]], asyncio.Future | None]


class KiteStreamAdapter:
    def __init__(self, kite_client: KiteClient, on_tick: Callable[[dict[str, Any]], Any]) -> None:
        self.kite_client = kite_client
        self.on_tick = on_tick
        self._loop: asyncio.AbstractEventLoop | None = None
        self._ticker: Any = None
        self._lock = asyncio.Lock()
        self._desired_tokens: set[int] = set()
        self._active_tokens: set[int] = set()
        self._connected = False
        self._running = False
        self._has_library = True
        self._last_tick_mono = 0.0
        self._manual_reconnect_task: asyncio.Task | None = None
        self._heartbeat_task: asyncio.Task | None = None
        self._thread_lock = threading.Lock()
        self._ws_thread: threading.Thread | None = None
        self._last_status = "init"

    @property
    def last_status(self) -> str:
        return self._last_status

    @property
    def enabled(self) -> bool:
        return bool(self._running and self._has_library and self.kite_client.api_key and self.kite_client.resolve_access_token())

    @property
    def connected(self) -> bool:
        return self._connected

    async def start(self) -> None:
        async with self._lock:
            if self._running:
                return
            self._running = True
            self._loop = asyncio.get_running_loop()
            self._last_tick_mono = time.monotonic()

        try:
            self._build_ticker()
        except Exception as exc:
            self._last_status = "disabled"
            logger.warning("event=kite_stream_disabled reason=%s", exc)
            async with self._lock:
                self._has_library = False
            return

        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop(), name="kite-heartbeat")
        self._connect_ticker()
        self._last_status = "starting"
        logger.info("event=kite_stream_started")

    async def stop(self) -> None:
        async with self._lock:
            self._running = False
            reconnect_task = self._manual_reconnect_task
            self._manual_reconnect_task = None
            heartbeat_task = self._heartbeat_task
            self._heartbeat_task = None
            ticker = self._ticker
            self._ticker = None
            self._connected = False
            self._desired_tokens.clear()
            self._active_tokens.clear()

        if reconnect_task:
            reconnect_task.cancel()
            try:
                await reconnect_task
            except asyncio.CancelledError:
                pass

        if heartbeat_task:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

        if ticker is not None:
            try:
                ticker.close()
            except Exception:
                pass
        self._last_status = "stopped"
        logger.info("event=kite_stream_stopped")

    async def set_tokens(self, tokens: set[int]) -> None:
        async with self._lock:
            self._desired_tokens = {int(t) for t in tokens if isinstance(t, int)}
            ticker = self._ticker
            connected = self._connected
            desired = set(self._desired_tokens)

        if not ticker:
            return

        if connected:
            await self._apply_subscriptions(desired)

    async def _apply_subscriptions(self, desired: set[int], force_full: bool = False) -> None:
        ticker = self._ticker
        if not ticker:
            return
        try:
            to_subscribe = set(desired) if force_full else (set(desired) - self._active_tokens)
            to_unsubscribe = self._active_tokens - set(desired)

            if to_subscribe:
                await asyncio.to_thread(ticker.subscribe, sorted(to_subscribe))
                if hasattr(ticker, "set_mode"):
                    mode_full = getattr(ticker, "MODE_FULL", None)
                    if mode_full is not None:
                        await asyncio.to_thread(ticker.set_mode, mode_full, sorted(to_subscribe))
            if to_unsubscribe:
                await asyncio.to_thread(ticker.unsubscribe, sorted(to_unsubscribe))
            self._active_tokens = set(desired)
        except Exception as exc:
            logger.debug("Kite subscribe sync failed: %s", exc)

    def _build_ticker(self) -> None:
        from kiteconnect import KiteTicker  # type: ignore

        token = self.kite_client.resolve_access_token()
        if not self.kite_client.api_key or not token:
            raise RuntimeError("Kite credentials unavailable")

        ticker = KiteTicker(
            self.kite_client.api_key,
            token,
            reconnect=True,
            reconnect_max_tries=300,
            reconnect_max_delay=60,
            connect_timeout=30,
        )
        ticker.on_connect = self._on_connect
        ticker.on_ticks = self._on_ticks
        ticker.on_close = self._on_close
        ticker.on_error = self._on_error
        ticker.on_reconnect = self._on_reconnect
        ticker.on_noreconnect = self._on_noreconnect
        self._ticker = ticker

    def _connect_ticker(self) -> None:
        ticker = self._ticker
        if ticker is None:
            return

        def _runner() -> None:
            try:
                ticker.connect(threaded=False)
            except Exception as exc:
                logger.warning("Kite WS connect runner failed: %s", exc)

        with self._thread_lock:
            if self._ws_thread and self._ws_thread.is_alive():
                return
            self._ws_thread = threading.Thread(target=_runner, name="kite-ws-thread", daemon=True)
            self._ws_thread.start()

    def _schedule_coroutine(self, coro: asyncio.coroutines) -> None:
        loop = self._loop
        if not loop:
            return
        try:
            asyncio.run_coroutine_threadsafe(coro, loop)
        except Exception:
            pass

    def _on_connect(self, ws: Any, response: Any) -> None:
        self._last_status = "connected"
        logger.info("event=kite_ws_connected")
        self._connected = True
        self._active_tokens = set()
        self._last_tick_mono = time.monotonic()
        self._schedule_coroutine(self._apply_subscriptions(set(self._desired_tokens), force_full=True))

    def _on_ticks(self, ws: Any, ticks: list[dict[str, Any]]) -> None:
        self._last_tick_mono = time.monotonic()
        for tick in ticks:
            payload = {
                "instrument_token": tick.get("instrument_token"),
                "last_price": tick.get("last_price"),
                "ohlc": tick.get("ohlc") if isinstance(tick.get("ohlc"), dict) else {},
                "exchange_timestamp": tick.get("exchange_timestamp"),
                "last_trade_time": tick.get("last_trade_time"),
                "volume_traded": tick.get("volume_traded"),
                "volume": tick.get("volume"),
                "oi": tick.get("oi"),
            }
            self._schedule_coroutine(self._emit_tick(payload))

    async def _emit_tick(self, payload: dict[str, Any]) -> None:
        try:
            result = self.on_tick(payload)
            if asyncio.iscoroutine(result):
                await result
        except Exception as exc:
            logger.debug("Kite tick emit failed: %s", exc)

    def _on_close(self, ws: Any, code: int, reason: str) -> None:
        self._last_status = f"closed:{code}"
        logger.warning("event=kite_ws_closed code=%s reason=%s", code, reason)
        self._connected = False
        self._schedule_coroutine(self._ensure_manual_reconnect())

    def _on_error(self, ws: Any, code: int, reason: str) -> None:
        self._last_status = f"error:{code}"
        logger.warning("event=kite_ws_error code=%s reason=%s", code, reason)

    def _on_reconnect(self, ws: Any, attempt_count: int) -> None:
        self._last_status = f"reconnect:{attempt_count}"
        logger.info("event=kite_ws_reconnect attempt=%s", attempt_count)

    def _on_noreconnect(self, ws: Any) -> None:
        self._last_status = "noreconnect"
        logger.warning("event=kite_ws_noreconnect")
        self._connected = False
        self._schedule_coroutine(self._ensure_manual_reconnect())

    async def _ensure_manual_reconnect(self) -> None:
        async with self._lock:
            if not self._running or self._manual_reconnect_task:
                return
            self._manual_reconnect_task = asyncio.create_task(
                self._manual_reconnect_loop(), name="kite-manual-reconnect"
            )
            self._last_status = "manual_reconnect_scheduled"
            logger.info("event=kite_manual_reconnect_scheduled")

    async def _manual_reconnect_loop(self) -> None:
        delay = 2.0
        try:
            while True:
                async with self._lock:
                    if not self._running:
                        return
                    connected = self._connected
                if connected:
                    return
                await asyncio.sleep(delay)
                delay = min(delay * 2.0, 60.0)
                self._last_status = "manual_reconnect_attempt"
                logger.info("event=kite_manual_reconnect_attempt delay_next=%s", delay)
                try:
                    ticker = self._ticker
                    if ticker:
                        await asyncio.to_thread(ticker.close)
                except Exception:
                    pass
                try:
                    self._build_ticker()
                except Exception as exc:
                    self._last_status = "manual_reconnect_build_failed"
                    logger.warning("event=kite_manual_reconnect_build_failed reason=%s", exc)
                    continue
                self._connect_ticker()
        finally:
            async with self._lock:
                self._manual_reconnect_task = None
            logger.info("event=kite_manual_reconnect_loop_stopped")

    async def _heartbeat_loop(self) -> None:
        try:
            while True:
                async with self._lock:
                    if not self._running:
                        return
                    ticker = self._ticker
                    connected = self._connected
                    has_subs = bool(self._desired_tokens)
                if connected and ticker is not None and has_subs:
                    # If we don't receive ticks for an extended window, request resubscribe.
                    if (time.monotonic() - self._last_tick_mono) > 30:
                        try:
                            if hasattr(ticker, "resubscribe"):
                                await asyncio.to_thread(ticker.resubscribe)
                            else:
                                await self._apply_subscriptions(set(self._desired_tokens))
                            self._last_tick_mono = time.monotonic()
                        except Exception as exc:
                            logger.debug("Kite heartbeat resubscribe failed: %s", exc)
                await asyncio.sleep(10)
        except asyncio.CancelledError:
            raise
