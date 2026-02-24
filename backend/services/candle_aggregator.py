from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


@dataclass
class LiveCandle:
    interval_start: datetime
    open: float = 0.0
    high: float = 0.0
    low: float = 0.0
    close: float = 0.0
    volume: float = 0.0
    initialized: bool = False

    def update(self, price: float, volume: float = 0.0) -> None:
        if not self.initialized:
            self.open = self.high = self.low = self.close = float(price)
            self.volume = float(volume or 0)
            self.initialized = True
            return
        self.high = max(self.high, float(price))
        self.low = min(self.low, float(price))
        self.close = float(price)
        self.volume += float(volume or 0)

    def to_ws_payload(self) -> dict[str, Any]:
        return {
            "t": int(self.interval_start.timestamp() * 1000),
            "o": float(self.open),
            "h": float(self.high),
            "l": float(self.low),
            "c": float(self.close),
            "v": float(self.volume),
        }


class CandleAggregator:
    INTERVALS = {
        "1m": timedelta(minutes=1),
        "5m": timedelta(minutes=5),
        "15m": timedelta(minutes=15),
    }

    def __init__(self) -> None:
        self._candles: dict[str, dict[str, LiveCandle]] = defaultdict(dict)

    @staticmethod
    def _align_bucket(ts: datetime, delta: timedelta) -> datetime:
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        ts = ts.astimezone(timezone.utc)
        epoch = datetime(2000, 1, 1, tzinfo=timezone.utc)
        span = int(delta.total_seconds())
        offset = int((ts - epoch).total_seconds())
        aligned = (offset // span) * span
        return epoch + timedelta(seconds=aligned)

    def on_tick(
        self,
        symbol_token: str,
        price: float,
        volume: float | int | None = None,
        ts: datetime | None = None,
    ) -> list[tuple[str, str, dict[str, Any]]]:
        now = ts or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        completed: list[tuple[str, str, dict[str, Any]]] = []
        for interval, delta in self.INTERVALS.items():
            bucket = self._align_bucket(now, delta)
            existing = self._candles[symbol_token].get(interval)
            if existing is None:
                existing = LiveCandle(interval_start=bucket)
                self._candles[symbol_token][interval] = existing
            if existing.interval_start != bucket:
                completed.append((symbol_token, interval, existing.to_ws_payload()))
                existing = LiveCandle(interval_start=bucket)
                self._candles[symbol_token][interval] = existing
            existing.update(float(price), float(volume or 0))
        return completed

    def current_candles(self, symbol_token: str) -> list[tuple[str, str, dict[str, Any]]]:
        rows = self._candles.get(symbol_token) or {}
        out: list[tuple[str, str, dict[str, Any]]] = []
        for interval, candle in rows.items():
            if not candle.initialized:
                continue
            out.append((symbol_token, interval, candle.to_ws_payload()))
        return out
