from __future__ import annotations

from dataclasses import dataclass
from statistics import mean
from typing import Any, Iterable


_EPS = 1e-9
_SUPPORTED_PATTERNS = {
    "range_breakout_up",
    "range_breakdown_down",
    "volume_spike_breakout",
}


@dataclass(frozen=True)
class Candle:
    timestamp: str | None
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class PatternSignal:
    pattern: str
    triggered: bool
    direction: str
    confidence: float
    breakout_price: float | None
    metadata: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "pattern": self.pattern,
            "triggered": self.triggered,
            "direction": self.direction,
            "confidence": self.confidence,
            "breakout_price": self.breakout_price,
            "metadata": self.metadata,
        }


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _to_float(raw: Any, default: float = 0.0) -> float:
    try:
        value = float(raw)
    except Exception:
        return default
    if value != value:  # NaN
        return default
    return value


def _coerce_candle(raw: dict[str, Any]) -> Candle:
    return Candle(
        timestamp=(raw.get("timestamp") or raw.get("t") or None),
        open=_to_float(raw.get("open", raw.get("o", 0.0))),
        high=_to_float(raw.get("high", raw.get("h", 0.0))),
        low=_to_float(raw.get("low", raw.get("l", 0.0))),
        close=_to_float(raw.get("close", raw.get("c", 0.0))),
        volume=_to_float(raw.get("volume", raw.get("v", 0.0))),
    )


def _normalize_candles(candles: Iterable[dict[str, Any]]) -> list[Candle]:
    out: list[Candle] = []
    for row in candles:
        if not isinstance(row, dict):
            continue
        c = _coerce_candle(row)
        if c.high < c.low:
            c = Candle(c.timestamp, c.open, c.low, c.high, c.close, c.volume)
        out.append(c)
    return out


def _base_metadata(pattern: str, reason: str, lookback: int, bars_used: int) -> PatternSignal:
    return PatternSignal(
        pattern=pattern,
        triggered=False,
        direction="none",
        confidence=0.0,
        breakout_price=None,
        metadata={
            "reason": reason,
            "lookback": int(lookback),
            "bars_used": int(bars_used),
            "resistance": None,
            "support": None,
            "avg_volume": None,
            "volume_ratio": None,
        },
    )


def _detect_range_pattern(
    candles: list[Candle],
    pattern: str,
    lookback: int,
    min_volume_ratio: float,
    require_volume_spike: bool,
) -> PatternSignal:
    if lookback < 3:
        return _base_metadata(pattern, "lookback_too_small", lookback, len(candles))
    if len(candles) < lookback + 1:
        return _base_metadata(pattern, "insufficient_bars", lookback, len(candles))

    latest = candles[-1]
    hist = candles[-(lookback + 1) : -1]

    resistance = max(c.high for c in hist)
    support = min(c.low for c in hist)
    avg_volume = max(mean(c.volume for c in hist), _EPS)
    volume_ratio = latest.volume / avg_volume
    range_span = max(resistance - support, _EPS)
    atr = max(mean(c.high - c.low for c in hist), _EPS)

    min_ratio = max(1.0, min_volume_ratio)
    if require_volume_spike:
        min_ratio = max(min_ratio, 1.6)

    if pattern == "range_breakdown_down":
        crossed = latest.close < support
        distance = (support - latest.close) / range_span
        direction = "down"
        breakout_price = support if crossed else None
    else:
        crossed = latest.close > resistance
        distance = (latest.close - resistance) / range_span
        direction = "up"
        breakout_price = resistance if crossed else None

    vol_component = _clamp01((volume_ratio - 1.0) / max(min_ratio - 1.0, 0.15))
    dist_component = _clamp01(distance / 0.5)
    range_component = _clamp01((latest.high - latest.low) / atr - 0.5)
    raw_conf = 0.55 * dist_component + 0.30 * vol_component + 0.15 * range_component

    if not crossed:
        near_level = _clamp01((1.0 - abs(distance)) * 0.25)
        raw_conf = min(raw_conf, near_level)
    if volume_ratio < min_ratio:
        raw_conf *= max(0.0, volume_ratio / min_ratio)

    confidence = _clamp01(raw_conf)
    triggered = bool(crossed and volume_ratio >= min_ratio and confidence >= 0.15)

    return PatternSignal(
        pattern=pattern,
        triggered=triggered,
        direction=direction if triggered else "none",
        confidence=confidence,
        breakout_price=float(breakout_price) if breakout_price is not None else None,
        metadata={
            "lookback": lookback,
            "bars_used": len(candles),
            "resistance": float(resistance),
            "support": float(support),
            "avg_volume": float(avg_volume),
            "volume_ratio": float(volume_ratio),
            "min_volume_ratio": float(min_ratio),
            "distance_over_range": float(distance),
            "range_span": float(range_span),
            "atr": float(atr),
            "volume_spike_required": require_volume_spike,
        },
    )


def detect_pattern(
    candles: Iterable[dict[str, Any]],
    pattern: str,
    *,
    lookback: int = 20,
    min_volume_ratio: float = 1.2,
) -> dict[str, Any]:
    normalized = _normalize_candles(candles)
    normalized_pattern = str(pattern or "").strip().lower()
    if normalized_pattern not in _SUPPORTED_PATTERNS:
        return {
            "pattern": normalized_pattern,
            "triggered": False,
            "direction": "none",
            "confidence": 0.0,
            "breakout_price": None,
            "metadata": {
                "reason": "unsupported_pattern",
                "supported_patterns": sorted(_SUPPORTED_PATTERNS),
                "bars_used": len(normalized),
            },
        }

    if normalized_pattern == "volume_spike_breakout":
        sig = _detect_range_pattern(
            normalized,
            normalized_pattern,
            lookback=max(lookback, 10),
            min_volume_ratio=max(min_volume_ratio, 1.6),
            require_volume_spike=True,
        )
    else:
        sig = _detect_range_pattern(
            normalized,
            normalized_pattern,
            lookback=lookback,
            min_volume_ratio=min_volume_ratio,
            require_volume_spike=False,
        )
    return sig.to_dict()


def scan_patterns(
    candles: Iterable[dict[str, Any]],
    patterns: Iterable[str],
    *,
    lookback: int = 20,
    min_volume_ratio: float = 1.2,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for pattern in patterns:
        out.append(
            detect_pattern(
                candles,
                pattern,
                lookback=lookback,
                min_volume_ratio=min_volume_ratio,
            )
        )
    return out
