from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import WebSocket

from backend.services.data_quality_monitor import DataQualityMonitor
from backend.services.marketdata_hub import get_marketdata_hub

logger = logging.getLogger(__name__)

US_EASTERN = ZoneInfo("America/New_York")
ALPACA_WS_URL = "wss://stream.data.alpaca.markets/v2/iex"
FINNHUB_WS_URL = "wss://ws.finnhub.io"
ALPACA_BARS_URL = "https://data.alpaca.markets/v2/stocks/bars"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_dt_utc(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except Exception:
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _minute_floor(ts: datetime) -> datetime:
    ts = ts.astimezone(timezone.utc)
    return ts.replace(second=0, microsecond=0)


def _session_for_us_bar(ts_utc: datetime) -> tuple[str, bool]:
    et = ts_utc.astimezone(US_EASTERN)
    minutes = et.hour * 60 + et.minute
    regular_start = 9 * 60 + 30
    regular_end = 16 * 60
    if minutes < 4 * 60 or minutes >= 20 * 60 or et.weekday() >= 5:
        return "off", False
    if minutes < regular_start:
        return "pre", True
    if minutes < regular_end:
        return "regular", False
    return "post", True


@dataclass
class ProviderHealth:
    name: str
    connected: bool = False
    error_count: int = 0
    total_messages: int = 0
    last_message_mono: float = 0.0
    last_error: str | None = None
    recent_latencies_ms: deque[float] = field(default_factory=lambda: deque(maxlen=120))
    recent_message_monos: deque[float] = field(default_factory=lambda: deque(maxlen=600))

    def record_message(self, latency_ms: float | None = None) -> None:
        now_mono = time.monotonic()
        self.total_messages += 1
        self.last_message_mono = now_mono
        self.recent_message_monos.append(now_mono)
        if latency_ms is not None and latency_ms >= 0:
            self.recent_latencies_ms.append(float(latency_ms))

    def record_error(self, message: str) -> None:
        self.error_count += 1
        self.last_error = message[:240]

    @property
    def avg_latency_ms(self) -> float:
        if not self.recent_latencies_ms:
            return 0.0
        return sum(self.recent_latencies_ms) / len(self.recent_latencies_ms)

    @property
    def message_rate_per_sec(self) -> float:
        if not self.recent_message_monos:
            return 0.0
        now_mono = time.monotonic()
        window_count = sum(1 for m in self.recent_message_monos if now_mono - m <= 60)
        return window_count / 60.0

    @property
    def silence_seconds(self) -> float:
        if self.last_message_mono <= 0:
            return 9999.0
        return max(0.0, time.monotonic() - self.last_message_mono)

    def healthy_enough(self) -> bool:
        return self.connected and self.silence_seconds <= 5.0 and self.avg_latency_ms <= 5000.0

    def score(self) -> float:
        score = 100.0
        if not self.connected:
            score -= 50
        score -= min(30.0, self.avg_latency_ms / 250.0)
        score -= min(20.0, float(self.error_count))
        score -= min(25.0, self.silence_seconds * 2.0)
        return round(max(0.0, score), 2)

    def snapshot(self) -> dict[str, Any]:
        return {
            "provider": self.name,
            "connected": self.connected,
            "error_count": self.error_count,
            "total_messages": self.total_messages,
            "avg_latency_ms": round(self.avg_latency_ms, 2),
            "message_rate_per_sec": round(self.message_rate_per_sec, 3),
            "silence_seconds": round(self.silence_seconds, 3),
            "score": self.score(),
            "last_error": self.last_error,
        }


@dataclass
class _LiveBar:
    start: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    pv_sum: float
    ticks: int = 1

    def update(self, price: float, size: float) -> None:
        self.high = max(self.high, price)
        self.low = min(self.low, price)
        self.close = price
        self.volume += size
        self.pv_sum += price * size
        self.ticks += 1

    def to_payload(self, symbol: str, status: str) -> dict[str, Any]:
        session, ext = _session_for_us_bar(self.start)
        vwap = (self.pv_sum / self.volume) if self.volume > 0 else self.close
        return {
            "type": "bar",
            "symbol": symbol,
            "interval": "1m",
            "status": status,
            "t": int(self.start.timestamp() * 1000),
            "o": float(self.open),
            "h": float(self.high),
            "l": float(self.low),
            "c": float(self.close),
            "v": float(self.volume),
            "vwap": float(vwap),
            "s": session,
            "ext": bool(ext),
            "ticks": int(self.ticks),
        }


class TickAggregator:
    def __init__(self, max_bars_per_symbol: int = 390) -> None:
        self._max_bars = max_bars_per_symbol
        self._live: dict[str, _LiveBar] = {}
        self._closed: dict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=self._max_bars))

    def on_trade(self, symbol: str, price: float, size: float, ts: datetime) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        key = symbol.strip().upper()
        if not key:
            return [], None
        bucket = _minute_floor(ts)
        emitted: list[dict[str, Any]] = []
        live = self._live.get(key)
        if live is None:
            live = _LiveBar(bucket, price, price, price, price, size, price * size)
            self._live[key] = live
            return emitted, live.to_payload(key, "partial")
        if live.start != bucket:
            closed_payload = live.to_payload(key, "closed")
            self._closed[key].append(closed_payload)
            emitted.append(closed_payload)
            live = _LiveBar(bucket, price, price, price, price, size, price * size)
            self._live[key] = live
            return emitted, live.to_payload(key, "partial")
        live.update(price, size)
        return emitted, live.to_payload(key, "partial")

    def flush_expired(self, now: datetime | None = None) -> list[dict[str, Any]]:
        current = _minute_floor(now or _utcnow())
        emitted: list[dict[str, Any]] = []
        for symbol, live in list(self._live.items()):
            if live.start < current:
                closed_payload = live.to_payload(symbol, "closed")
                self._closed[symbol].append(closed_payload)
                emitted.append(closed_payload)
                del self._live[symbol]
        return emitted

    def recent_bars(self, symbol: str) -> list[dict[str, Any]]:
        key = symbol.strip().upper()
        return list(self._closed.get(key, ()))

    def current_bar(self, symbol: str) -> dict[str, Any] | None:
        key = symbol.strip().upper()
        live = self._live.get(key)
        return None if live is None else live.to_payload(key, "partial")


class _USProviderClient:
    def __init__(self, service: "USTickStreamService", name: str) -> None:
        self.service = service
        self.name = name
        self.health = ProviderHealth(name=name)
        self._desired_symbols: set[str] = set()
        self._sent_symbols: set[str] = set()
        self._task: asyncio.Task | None = None
        self._running = False
        self._lock = asyncio.Lock()
        self._ws: Any = None

    async def start(self) -> None:
        async with self._lock:
            if self._running:
                return
            self._running = True
            self._task = asyncio.create_task(self._run_loop(), name=f"{self.name}-ws-loop")

    async def stop(self) -> None:
        async with self._lock:
            self._running = False
            task = self._task
            self._task = None
            ws = self._ws
            self._ws = None
            self.health.connected = False
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def set_symbols(self, symbols: set[str]) -> None:
        async with self._lock:
            self._desired_symbols = {s.strip().upper() for s in symbols if s and s.strip()}
            ws = self._ws
            connected = self.health.connected
        if ws and connected:
            await self._flush_subscriptions()

    async def _run_loop(self) -> None:
        delay = 1.0
        while True:
            async with self._lock:
                if not self._running:
                    return
            try:
                await self._connect_once()
                delay = 1.0
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.health.connected = False
                self.health.record_error(str(exc))
                logger.warning("%s websocket loop error: %s", self.name, exc)
                await self.service._publish_provider_health()  # noqa: SLF001
                await asyncio.sleep(delay)
                delay = min(delay * 2.0, 30.0)

    async def _connect_once(self) -> None:
        raise NotImplementedError

    async def _flush_subscriptions(self) -> None:
        raise NotImplementedError


class _FinnhubUSProvider(_USProviderClient):
    def __init__(self, service: "USTickStreamService") -> None:
        super().__init__(service, "finnhub")
        self.api_key = os.getenv("FINNHUB_API_KEY", "").strip()
        self.enabled = bool(self.api_key)

    async def _connect_once(self) -> None:
        if not self.enabled:
            await asyncio.sleep(5)
            return
        import websockets  # type: ignore

        url = f"{FINNHUB_WS_URL}?token={self.api_key}"
        async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
            async with self._lock:
                self._ws = ws
                self._sent_symbols.clear()
                self.health.connected = True
            await self.service._publish_provider_health()  # noqa: SLF001
            await self._flush_subscriptions()
            async for raw in ws:
                payload = json.loads(raw)
                if not isinstance(payload, dict):
                    continue
                if payload.get("type") != "trade":
                    continue
                for trade in payload.get("data") or []:
                    if not isinstance(trade, dict):
                        continue
                    symbol = str(trade.get("s") or "").strip().upper()
                    if not symbol:
                        continue
                    try:
                        price = float(trade.get("p"))
                        size = float(trade.get("v") or 0)
                        ts_ms = int(trade.get("t"))
                    except Exception:
                        continue
                    trade_dt = _to_dt_utc(ts_ms)
                    latency_ms = ((_utcnow() - trade_dt).total_seconds() * 1000.0) if trade_dt is not None else None
                    self.health.record_message(latency_ms)
                    await self.service.on_provider_trade(
                        provider="finnhub",
                        symbol=symbol,
                        price=price,
                        size=size,
                        ts=trade_dt or _utcnow(),
                        latency_ms=latency_ms,
                        raw=trade,
                    )
                    if self.health.total_messages % 25 == 0:
                        await self.service._publish_provider_health()  # noqa: SLF001
        async with self._lock:
            self._ws = None
            self._sent_symbols.clear()
            self.health.connected = False
        await self.service._publish_provider_health()  # noqa: SLF001

    async def _flush_subscriptions(self) -> None:
        async with self._lock:
            ws = self._ws
            desired = set(self._desired_symbols)
            sent = set(self._sent_symbols)
        if ws is None:
            return
        to_sub = sorted(desired - sent)
        to_unsub = sorted(sent - desired)
        for symbol in to_unsub:
            await ws.send(json.dumps({"type": "unsubscribe", "symbol": symbol}))
        for symbol in to_sub:
            await ws.send(json.dumps({"type": "subscribe", "symbol": symbol}))
        async with self._lock:
            self._sent_symbols = desired


class _AlpacaUSProvider(_USProviderClient):
    def __init__(self, service: "USTickStreamService") -> None:
        super().__init__(service, "alpaca")
        self.api_key = os.getenv("ALPACA_API_KEY", "").strip()
        self.secret_key = os.getenv("ALPACA_SECRET_KEY", "").strip()
        self.enabled = bool(self.api_key and self.secret_key)

    async def _connect_once(self) -> None:
        if not self.enabled:
            await asyncio.sleep(5)
            return
        import websockets  # type: ignore

        async with websockets.connect(ALPACA_WS_URL, ping_interval=20, ping_timeout=20) as ws:
            async with self._lock:
                self._ws = ws
                self._sent_symbols.clear()
            await ws.send(json.dumps({"action": "auth", "key": self.api_key, "secret": self.secret_key}))
            for _ in range(3):
                raw = await ws.recv()
                try:
                    payload = json.loads(raw)
                except Exception:
                    payload = None
                if isinstance(payload, list) and any(isinstance(x, dict) and x.get("msg") == "authenticated" for x in payload):
                    break
            self.health.connected = True
            await self.service._publish_provider_health()  # noqa: SLF001
            await self._flush_subscriptions()
            async for raw in ws:
                payload = json.loads(raw)
                frames = payload if isinstance(payload, list) else [payload]
                for msg in frames:
                    if not isinstance(msg, dict):
                        continue
                    if msg.get("T") != "t":
                        continue
                    symbol = str(msg.get("S") or "").strip().upper()
                    if not symbol:
                        continue
                    try:
                        price = float(msg.get("p"))
                        size = float(msg.get("s") or 0)
                    except Exception:
                        continue
                    ts_dt = _to_dt_utc(msg.get("t")) or _utcnow()
                    latency_ms = (_utcnow() - ts_dt).total_seconds() * 1000.0
                    self.health.record_message(latency_ms)
                    await self.service.on_provider_trade(
                        provider="alpaca",
                        symbol=symbol,
                        price=price,
                        size=size,
                        ts=ts_dt,
                        latency_ms=latency_ms,
                        raw=msg,
                    )
                    if self.health.total_messages % 25 == 0:
                        await self.service._publish_provider_health()  # noqa: SLF001
        async with self._lock:
            self._ws = None
            self._sent_symbols.clear()
            self.health.connected = False
        await self.service._publish_provider_health()  # noqa: SLF001

    async def _flush_subscriptions(self) -> None:
        async with self._lock:
            ws = self._ws
            desired = sorted(self._desired_symbols)
        if ws is None:
            return
        await ws.send(json.dumps({"action": "subscribe", "trades": desired}))
        async with self._lock:
            self._sent_symbols = set(desired)


@dataclass
class _USClientSubscription:
    symbols: set[str] = field(default_factory=set)
    channels: set[str] = field(default_factory=lambda: {"trades", "bars"})


class USTickStreamService:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._clients: dict[WebSocket, _USClientSubscription] = {}
        self._running = False
        self._flush_task: asyncio.Task | None = None
        self._aggregator = TickAggregator(max_bars_per_symbol=390)
        self._finnhub = _FinnhubUSProvider(self)
        self._alpaca = _AlpacaUSProvider(self)
        self._last_trade_seen: dict[str, tuple[int, float, float, str]] = {}
        self._dq = DataQualityMonitor()

    async def start(self) -> None:
        async with self._lock:
            if self._running:
                return
            self._running = True
            self._flush_task = asyncio.create_task(self._flush_loop(), name="us-bars-flush-loop")
        self._dq.set_alert_emitter(get_marketdata_hub().broadcast_alert)
        await self._dq.start()
        await self._alpaca.start()
        await self._finnhub.start()
        await self._publish_provider_health()

    async def shutdown(self) -> None:
        async with self._lock:
            self._running = False
            task = self._flush_task
            self._flush_task = None
            sockets = list(self._clients.keys())
            self._clients.clear()
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self._alpaca.stop()
        await self._finnhub.stop()
        await self._dq.stop()
        for ws in sockets:
            try:
                await ws.close()
            except Exception:
                pass

    async def register(self, websocket: WebSocket) -> None:
        await self.start()
        async with self._lock:
            self._clients.setdefault(websocket, _USClientSubscription())

    async def unregister(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._clients.pop(websocket, None)
        await self._sync_provider_symbols()

    async def subscribe(self, websocket: WebSocket, symbols: list[str], channels: list[str] | None = None) -> dict[str, Any]:
        normalized_symbols = self._normalize_symbols(symbols)
        normalized_channels = self._normalize_channels(channels)
        newly_added: set[str] = set()
        async with self._lock:
            sub = self._clients.get(websocket)
            if sub is None:
                return {"symbols": [], "channels": []}
            for symbol in normalized_symbols:
                if symbol not in sub.symbols:
                    newly_added.add(symbol)
                sub.symbols.add(symbol)
            if normalized_channels:
                sub.channels.update(normalized_channels)
        await self._sync_provider_symbols()
        for symbol in sorted(newly_added):
            await self._send_backfill(websocket, symbol)
            current_bar = self._aggregator.current_bar(symbol)
            if current_bar is not None and "bars" in normalized_channels:
                try:
                    await websocket.send_json(current_bar)
                except Exception:
                    break
        return {"symbols": sorted(normalized_symbols), "channels": sorted(normalized_channels)}

    async def unsubscribe(self, websocket: WebSocket, symbols: list[str], channels: list[str] | None = None) -> dict[str, Any]:
        normalized_symbols = self._normalize_symbols(symbols)
        normalized_channels = self._normalize_channels(channels)
        async with self._lock:
            sub = self._clients.get(websocket)
            if sub is None:
                return {"symbols": [], "channels": []}
            for symbol in normalized_symbols:
                sub.symbols.discard(symbol)
            if normalized_channels:
                for channel in normalized_channels:
                    sub.channels.discard(channel)
                if not sub.channels:
                    sub.channels = {"trades", "bars"}
        await self._sync_provider_symbols()
        return {"symbols": sorted(normalized_symbols), "channels": sorted(normalized_channels)}

    async def on_provider_trade(
        self,
        *,
        provider: str,
        symbol: str,
        price: float,
        size: float,
        ts: datetime,
        latency_ms: float | None,
        raw: dict[str, Any] | None = None,
    ) -> None:
        provider_name = provider.lower()
        symbol_key = symbol.strip().upper()
        if not symbol_key:
            return
        if not self._accept_trade(provider_name, symbol_key, price, size, ts):
            return
        await self._dq.record_tick(symbol_key, ts, provider_name, latency_ms)

        trade_payload = {
            "type": "trade",
            "symbol": symbol_key,
            "p": float(price),
            "v": float(size or 0.0),
            "t": int(ts.timestamp() * 1000),
            "ts": ts.isoformat(),
            "provider": provider_name,
            "latency_ms": round(float(latency_ms), 2) if latency_ms is not None else None,
            "raw": raw or {},
        }
        await self._broadcast("trades", symbol_key, trade_payload)

        closed_bars, partial_bar = self._aggregator.on_trade(symbol_key, float(price), float(size or 0.0), ts)
        if partial_bar is not None:
            partial_bar["provider"] = provider_name
            await self._broadcast("bars", symbol_key, partial_bar)
        for bar in closed_bars:
            await self._record_closed_bar(bar)
            bar["provider"] = provider_name
            await self._broadcast("bars", symbol_key, bar)

    async def data_quality_report(self) -> dict[str, Any]:
        await self._publish_provider_health()
        report = await self._dq.get_report()
        report["us_stream"] = {
            "primary_provider": self._primary_provider_name(),
            "providers": self.provider_health_snapshot(),
        }
        return report

    def provider_health_snapshot(self) -> dict[str, Any]:
        return {
            "alpaca": self._alpaca.health.snapshot(),
            "finnhub": self._finnhub.health.snapshot(),
        }

    def primary_provider_name(self) -> str:
        return self._primary_provider_name()

    async def _broadcast(self, channel: str, symbol: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            targets = [ws for ws, sub in self._clients.items() if symbol in sub.symbols and channel in sub.channels]
        stale: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)
        if stale:
            async with self._lock:
                for ws in stale:
                    self._clients.pop(ws, None)
            await self._sync_provider_symbols()

    async def _publish_provider_health(self) -> None:
        snapshots = self.provider_health_snapshot()
        await self._dq.update_provider_health("alpaca", snapshots["alpaca"])
        await self._dq.update_provider_health("finnhub", snapshots["finnhub"])
        payload = {
            "type": "provider_health",
            "primary_provider": self._primary_provider_name(),
            "providers": snapshots,
            "timestamp": _utcnow().isoformat(),
        }
        async with self._lock:
            targets = list(self._clients.keys())
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                continue

    def _primary_provider_name(self) -> str:
        primary = self._alpaca.health
        secondary = self._finnhub.health
        if not primary.healthy_enough() and secondary.connected:
            return "finnhub"
        if primary.connected:
            return "alpaca"
        if secondary.connected:
            return "finnhub"
        return "none"

    def _accept_trade(self, provider: str, symbol: str, price: float, size: float, ts: datetime) -> bool:
        ts_ms = int(ts.timestamp() * 1000)
        sig = (ts_ms, round(float(price), 6), round(float(size or 0.0), 6), provider)
        prev = self._last_trade_seen.get(symbol)
        primary = self._primary_provider_name()
        if prev is not None:
            prev_ts_ms, prev_price, prev_size, prev_provider = prev
            if prev_ts_ms == sig[0] and prev_price == sig[1] and prev_size == sig[2]:
                if prev_provider == primary:
                    return False
                if provider == primary:
                    self._last_trade_seen[symbol] = sig
                    return True
                return False
        if provider != primary and primary != "none":
            primary_health = self._alpaca.health if primary == "alpaca" else self._finnhub.health
            if primary_health.healthy_enough() and primary_health.silence_seconds < 5.0 and prev and (ts_ms - prev[0]) <= 500:
                return False
        self._last_trade_seen[symbol] = sig
        return True

    async def _record_closed_bar(self, bar: dict[str, Any]) -> None:
        ts = _to_dt_utc(bar.get("t"))
        symbol = str(bar.get("symbol") or "").strip().upper()
        if ts is None or not symbol:
            return
        await self._dq.record_bar(symbol, ts)

    async def _flush_loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(1)
                for bar in self._aggregator.flush_expired():
                    await self._record_closed_bar(bar)
                    await self._broadcast("bars", str(bar.get("symbol") or ""), bar)
                if int(time.time()) % 10 == 0:
                    await self._publish_provider_health()
        except asyncio.CancelledError:
            raise

    async def _sync_provider_symbols(self) -> None:
        async with self._lock:
            symbols: set[str] = set()
            for sub in self._clients.values():
                symbols.update(sub.symbols)
        await self._alpaca.set_symbols(symbols)
        await self._finnhub.set_symbols(symbols)

    def _normalize_symbols(self, symbols: list[str]) -> set[str]:
        out: set[str] = set()
        for raw in symbols:
            if not isinstance(raw, str):
                continue
            token = raw.strip().upper()
            if not token:
                continue
            if token.startswith("US:"):
                token = token.split(":", 1)[1]
            elif ":" in token:
                market, sym = token.split(":", 1)
                if market in {"NASDAQ", "NYSE"}:
                    token = sym
                else:
                    continue
            if token:
                out.add(token)
        return out

    @staticmethod
    def _normalize_channels(channels: list[str] | None) -> set[str]:
        if not channels:
            return {"bars", "trades"}
        out = {str(c).strip().lower() for c in channels if isinstance(c, str)}
        return {c for c in out if c in {"bars", "trades"}}

    async def _send_backfill(self, websocket: WebSocket, symbol: str) -> None:
        bars = await self._fetch_alpaca_backfill(symbol)
        payload = {
            "type": "backfill",
            "symbol": symbol,
            "interval": "1m",
            "provider": "alpaca",
            "bars": bars,
            "timestamp": _utcnow().isoformat(),
        }
        try:
            await websocket.send_json(payload)
        except Exception:
            return

    async def _fetch_alpaca_backfill(self, symbol: str) -> list[dict[str, Any]]:
        api_key = self._alpaca.api_key
        secret = self._alpaca.secret_key
        if not api_key or not secret:
            return []
        end = _utcnow()
        start = end - timedelta(days=5)
        params = {
            "symbols": symbol,
            "timeframe": "1Min",
            "start": start.isoformat().replace("+00:00", "Z"),
            "end": end.isoformat().replace("+00:00", "Z"),
            "feed": "iex",
            "adjustment": "raw",
            "sort": "asc",
            "limit": 5000,
        }
        headers = {
            "APCA-API-KEY-ID": api_key,
            "APCA-API-SECRET-KEY": secret,
        }
        try:
            async with httpx.AsyncClient(timeout=15.0, trust_env=False) as client:
                resp = await client.get(ALPACA_BARS_URL, params=params, headers=headers)
            if resp.status_code >= 400:
                logger.debug("Alpaca backfill failed symbol=%s status=%s body=%s", symbol, resp.status_code, resp.text[:200])
                return []
            payload = resp.json()
        except Exception as exc:
            logger.debug("Alpaca backfill error symbol=%s err=%s", symbol, exc)
            return []
        rows = (payload.get("bars") or {}).get(symbol) if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return []
        out: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            ts = _to_dt_utc(row.get("t"))
            if ts is None:
                continue
            try:
                o = float(row.get("o"))
                h = float(row.get("h"))
                l = float(row.get("l"))
                c = float(row.get("c"))
                v = float(row.get("v") or 0.0)
                vwap = float(row.get("vw") or c)
            except Exception:
                continue
            session, ext = _session_for_us_bar(ts)
            out.append({
                "t": int(ts.timestamp() * 1000),
                "o": o,
                "h": h,
                "l": l,
                "c": c,
                "v": v,
                "vwap": vwap,
                "s": session,
                "ext": ext,
            })
        return out


_us_tick_stream_service = USTickStreamService()


def get_us_tick_stream_service() -> USTickStreamService:
    return _us_tick_stream_service
