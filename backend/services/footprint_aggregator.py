from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
import re
from typing import Any

_PERIOD_RE = re.compile(r"^\s*(\d+)\s*([smhdwSMHDW])\s*$")


@dataclass(frozen=True)
class FootprintLevel:
    price: float
    bid_volume: float
    ask_volume: float
    delta: float


@dataclass(frozen=True)
class FootprintCandle:
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    levels: dict[float, FootprintLevel]
    total_bid_volume: float
    total_ask_volume: float
    delta: float


def _safe_float(value: Any) -> float | None:
    try:
        parsed = float(value)
        if not math.isfinite(parsed):
            return None
        return parsed
    except (TypeError, ValueError):
        return None


def _safe_int_ts(value: Any) -> int | None:
    if isinstance(value, datetime):
        ts = value
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return int(ts.timestamp())
    parsed = _safe_float(value)
    if parsed is None:
        return None
    return int(parsed)


def _parse_period_seconds(period: str) -> int:
    text = (period or "").strip()
    match = _PERIOD_RE.match(text)
    if not match:
        raise ValueError("candle_period must match <int>[s|m|h|d|w], e.g. 1m or 5m")
    amount = max(1, int(match.group(1)))
    unit = match.group(2).lower()
    if unit == "s":
        seconds = amount
    elif unit == "m":
        seconds = amount * 60
    elif unit == "h":
        seconds = amount * 3600
    elif unit == "d":
        seconds = amount * 86400
    else:
        seconds = amount * 7 * 86400
    return max(1, seconds)


def _price_precision(step: float) -> int:
    text = f"{step:.10f}".rstrip("0").rstrip(".")
    if "." not in text:
        return 0
    return len(text.split(".", 1)[1])


def _round_price_level(price: float, granularity: float) -> float:
    if granularity <= 0 or not math.isfinite(granularity):
        return price
    precision = _price_precision(granularity)
    return round(round(price / granularity) * granularity, precision)


def _bucket_timestamp(ts: int, period_seconds: int) -> int:
    return int(ts // period_seconds) * period_seconds


class FootprintAggregator:
    def aggregate(
        self,
        ticks: list[dict[str, Any]],
        candle_period: str,
        price_granularity: float,
    ) -> list[FootprintCandle]:
        period_seconds = _parse_period_seconds(candle_period)
        granularity = price_granularity if math.isfinite(price_granularity) and price_granularity > 0 else 1.0

        buckets: dict[int, dict[str, Any]] = {}
        for tick in ticks:
            ts = _safe_int_ts(tick.get("ts") or tick.get("timestamp") or tick.get("time"))
            price = _safe_float(tick.get("price"))
            size = _safe_float(tick.get("size") or tick.get("volume") or tick.get("qty"))
            if ts is None or price is None or size is None or size <= 0:
                continue

            bucket_ts = _bucket_timestamp(ts, period_seconds)
            bucket = buckets.setdefault(
                bucket_ts,
                {
                    "open": price,
                    "high": price,
                    "low": price,
                    "close": price,
                    "levels": {},
                    "total_bid_volume": 0.0,
                    "total_ask_volume": 0.0,
                    "first_ts": ts,
                },
            )
            if ts < bucket["first_ts"]:
                bucket["open"] = price
                bucket["first_ts"] = ts
            bucket["close"] = price
            bucket["high"] = max(bucket["high"], price)
            bucket["low"] = min(bucket["low"], price)

            side = str(tick.get("side") or tick.get("direction") or tick.get("aggressor") or "").strip().lower()
            is_buy = side in {"buy", "ask", "up", "bull", "bullish", "b"}
            is_sell = side in {"sell", "bid", "down", "bear", "bearish", "s"}
            if not (is_buy or is_sell):
                is_buy = price >= bucket["open"]

            level_price = _round_price_level(price, granularity)
            levels: dict[float, dict[str, float]] = bucket["levels"]
            level = levels.setdefault(level_price, {"bid_volume": 0.0, "ask_volume": 0.0})
            if is_buy:
                level["ask_volume"] += size
                bucket["total_ask_volume"] += size
            else:
                level["bid_volume"] += size
                bucket["total_bid_volume"] += size

        out: list[FootprintCandle] = []
        for bucket_ts in sorted(buckets):
            bucket = buckets[bucket_ts]
            levels: dict[float, FootprintLevel] = {}
            for price in sorted(bucket["levels"]):
                row = bucket["levels"][price]
                bid = float(row["bid_volume"])
                ask = float(row["ask_volume"])
                levels[price] = FootprintLevel(
                    price=price,
                    bid_volume=bid,
                    ask_volume=ask,
                    delta=ask - bid,
                )
            out.append(
                FootprintCandle(
                    timestamp=bucket_ts,
                    open=float(bucket["open"]),
                    high=float(bucket["high"]),
                    low=float(bucket["low"]),
                    close=float(bucket["close"]),
                    levels=levels,
                    total_bid_volume=float(bucket["total_bid_volume"]),
                    total_ask_volume=float(bucket["total_ask_volume"]),
                    delta=float(bucket["total_ask_volume"] - bucket["total_bid_volume"]),
                )
            )
        return out


def serialize_footprint_candle(candle: FootprintCandle) -> dict[str, Any]:
    return {
        "timestamp": candle.timestamp,
        "open": candle.open,
        "high": candle.high,
        "low": candle.low,
        "close": candle.close,
        "levels": [level.__dict__ for level in candle.levels.values()],
        "total_bid_volume": candle.total_bid_volume,
        "total_ask_volume": candle.total_ask_volume,
        "delta": candle.delta,
    }
