from __future__ import annotations

import asyncio
import logging
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

US_EASTERN = ZoneInfo("America/New_York")

AlertEmitter = Callable[[dict[str, Any]], Awaitable[None]]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _minute_key(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")


def _is_us_regular_or_extended_market_hours(ts: datetime) -> bool:
    et = ts.astimezone(US_EASTERN)
    if et.weekday() >= 5:
        return False
    minutes = et.hour * 60 + et.minute
    return (4 * 60) <= minutes < (20 * 60)


def _trading_minutes_elapsed_today(ts: datetime) -> int:
    et = ts.astimezone(US_EASTERN)
    if et.weekday() >= 5:
        return 0
    start = et.replace(hour=4, minute=0, second=0, microsecond=0)
    end = et.replace(hour=20, minute=0, second=0, microsecond=0)
    if et <= start:
        return 0
    if et >= end:
        return 960
    return int((et - start).total_seconds() // 60)


@dataclass
class SymbolMetrics:
    symbol: str
    last_tick_time: datetime | None = None
    last_bar_time: datetime | None = None
    bars_received_today: int = 0
    average_latency_ms: float = 0.0
    provider_source: str = "unknown"
    _latency_count: int = 0
    _ticks_this_minute: int = 0
    _tick_rate_history: deque[int] = field(default_factory=lambda: deque(maxlen=60))
    _current_minute_key: str | None = None
    _bar_minutes_seen_today: set[str] = field(default_factory=set)
    _gap_log: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=200))
    _stale_alert_emitted: bool = False

    def on_tick(self, ts: datetime, latency_ms: float | None, provider: str) -> None:
        ts = _to_utc(ts) or _utcnow()
        self.last_tick_time = ts
        self.provider_source = provider
        minute = _minute_key(ts)
        if self._current_minute_key is None:
            self._current_minute_key = minute
            self._tick_rate_history.append(0)
        elif minute != self._current_minute_key:
            self._current_minute_key = minute
            self._tick_rate_history.append(0)
        self._ticks_this_minute = (self._tick_rate_history[-1] if self._tick_rate_history else 0) + 1
        if self._tick_rate_history:
            self._tick_rate_history[-1] = self._ticks_this_minute
        if latency_ms is not None and latency_ms >= 0:
            self._latency_count += 1
            self.average_latency_ms += (latency_ms - self.average_latency_ms) / float(self._latency_count)
        self._stale_alert_emitted = False

    def on_bar(self, bar_time: datetime) -> None:
        bar_time = _to_utc(bar_time) or _utcnow()
        self.last_bar_time = bar_time
        key = _minute_key(bar_time)
        day_prefix = bar_time.strftime("%Y-%m-%d")
        # Reset day counters when the day changes.
        if self._bar_minutes_seen_today and not any(k.startswith(day_prefix) for k in self._bar_minutes_seen_today):
            self._bar_minutes_seen_today.clear()
            self.bars_received_today = 0
        if self._bar_minutes_seen_today:
            prev_keys = sorted(self._bar_minutes_seen_today)
            last_key = prev_keys[-1]
            try:
                prev_dt = datetime.fromisoformat(f"{last_key}:00+00:00")
                curr_dt = datetime.fromisoformat(f"{key}:00+00:00")
                gap_minutes = int((curr_dt - prev_dt).total_seconds() // 60)
                if gap_minutes > 1:
                    self._gap_log.append(
                        {
                            "type": "missing_bars",
                            "symbol": self.symbol,
                            "from": prev_dt.isoformat(),
                            "to": curr_dt.isoformat(),
                            "missing_count": gap_minutes - 1,
                        }
                    )
            except Exception:
                pass
        if key not in self._bar_minutes_seen_today:
            self._bar_minutes_seen_today.add(key)
            self.bars_received_today += 1

    def bars_expected_today(self, now: datetime | None = None) -> int:
        return _trading_minutes_elapsed_today(now or _utcnow())

    def tick_rate_sparkline(self) -> list[int]:
        history = list(self._tick_rate_history)
        if not history:
            return [0]
        return history

    def gap_events(self) -> list[dict[str, Any]]:
        return list(self._gap_log)

    def health_status(self, now: datetime | None = None, provider_connected: bool = True) -> str:
        current = now or _utcnow()
        if not provider_connected:
            return "disconnected"
        if self.last_tick_time is None:
            return "degraded"
        age_s = (current - self.last_tick_time).total_seconds()
        if _is_us_regular_or_extended_market_hours(current) and age_s > 300:
            return "stale"
        if age_s > 60 or self.average_latency_ms > 5000:
            return "degraded"
        return "healthy"


class DataQualityMonitor:
    def __init__(self, alert_emitter: AlertEmitter | None = None) -> None:
        self._symbols: dict[str, SymbolMetrics] = {}
        self._lock = asyncio.Lock()
        self._alert_emitter = alert_emitter
        self._provider_health: dict[str, dict[str, Any]] = {}
        self._stale_task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        async with self._lock:
            if self._running:
                return
            self._running = True
            self._stale_task = asyncio.create_task(self._stale_watch_loop(), name="data-quality-stale-watch")

    async def stop(self) -> None:
        async with self._lock:
            self._running = False
            task = self._stale_task
            self._stale_task = None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    def set_alert_emitter(self, alert_emitter: AlertEmitter) -> None:
        self._alert_emitter = alert_emitter

    async def update_provider_health(self, provider: str, snapshot: dict[str, Any]) -> None:
        async with self._lock:
            self._provider_health[str(provider).lower()] = dict(snapshot)

    async def record_tick(
        self,
        symbol: str,
        ts: datetime,
        provider: str,
        latency_ms: float | None = None,
    ) -> None:
        key = str(symbol or "").strip().upper()
        if not key:
            return
        async with self._lock:
            metrics = self._symbols.get(key)
            if metrics is None:
                metrics = SymbolMetrics(symbol=key)
                self._symbols[key] = metrics
            metrics.on_tick(ts, latency_ms, provider)

    async def record_bar(self, symbol: str, bar_start: datetime) -> None:
        key = str(symbol or "").strip().upper()
        if not key:
            return
        async with self._lock:
            metrics = self._symbols.get(key)
            if metrics is None:
                metrics = SymbolMetrics(symbol=key)
                self._symbols[key] = metrics
            metrics.on_bar(bar_start)

    async def get_report(self) -> dict[str, Any]:
        now = _utcnow()
        async with self._lock:
            provider_health = dict(self._provider_health)
            rows = []
            gap_events: list[dict[str, Any]] = []
            for symbol in sorted(self._symbols.keys()):
                metrics = self._symbols[symbol]
                provider_connected = bool(provider_health.get(metrics.provider_source, {}).get("connected", True))
                status = metrics.health_status(now=now, provider_connected=provider_connected)
                bars_expected = metrics.bars_expected_today(now)
                rows.append(
                    {
                        "symbol": symbol,
                        "last_tick_time": metrics.last_tick_time.isoformat() if metrics.last_tick_time else None,
                        "ticks_per_minute": metrics.tick_rate_sparkline()[-1] if metrics.tick_rate_sparkline() else 0,
                        "tick_rate_history": metrics.tick_rate_sparkline(),
                        "bars_received_today": metrics.bars_received_today,
                        "bars_expected_today": bars_expected,
                        "average_latency_ms": round(metrics.average_latency_ms, 2),
                        "provider_source": metrics.provider_source,
                        "health_status": status,
                    }
                )
                gap_events.extend(metrics.gap_events())
        return {
            "timestamp": now.isoformat(),
            "symbols": rows,
            "provider_health": provider_health,
            "gaps": gap_events[-200:],
        }

    async def _stale_watch_loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(30)
                await self._emit_stale_alerts()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Data quality stale watch loop failed")

    async def _emit_stale_alerts(self) -> None:
        emitter = self._alert_emitter
        if emitter is None:
            return
        now = _utcnow()
        if not _is_us_regular_or_extended_market_hours(now):
            return
        events: list[dict[str, Any]] = []
        async with self._lock:
            for metrics in self._symbols.values():
                if metrics.last_tick_time is None:
                    continue
                age_s = (now - metrics.last_tick_time).total_seconds()
                if age_s <= 300 or metrics._stale_alert_emitted:
                    continue
                metrics._stale_alert_emitted = True
                events.append(
                    {
                        "type": "data_quality_stale_symbol",
                        "symbol": metrics.symbol,
                        "age_seconds": int(age_s),
                        "provider": metrics.provider_source,
                        "timestamp": now.isoformat(),
                    }
                )
        for payload in events:
            try:
                await emitter(payload)
            except Exception:
                logger.exception("Failed to emit stale symbol alert")
