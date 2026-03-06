from __future__ import annotations

from typing import Any

from backend.breakout_engine.detectors import detect_pattern
from backend.shared.cache import cache as cache_instance


class BreakoutOccurrenceService:
    async def track(
        self,
        *,
        symbol: str,
        candles: list[dict[str, Any]],
        pattern: str,
        lookback: int = 20,
        min_volume_ratio: float = 1.2,
        cache_ttl: int = 120,
    ) -> dict[str, Any]:
        normalized_symbol = str(symbol or "").strip().upper()
        key = cache_instance.build_key(
            "breakout_occurrence",
            normalized_symbol,
            {
                "pattern": pattern,
                "lookback": lookback,
                "min_volume_ratio": min_volume_ratio,
                "bars": len(candles),
            },
        )
        cached = await cache_instance.get(key)
        if cached:
            payload = dict(cached)
            payload["meta"] = {
                **dict(payload.get("meta") or {}),
                "cache_hit": True,
            }
            return payload

        occurrences: list[dict[str, Any]] = []
        if len(candles) >= max(lookback + 1, 2):
            for idx in range(lookback + 1, len(candles) + 1):
                window = candles[:idx]
                signal = detect_pattern(
                    window,
                    pattern,
                    lookback=lookback,
                    min_volume_ratio=min_volume_ratio,
                )
                if bool(signal.get("triggered")):
                    latest = window[-1] if window else {}
                    occurrences.append(
                        {
                            "index": idx - 1,
                            "timestamp": latest.get("timestamp") or latest.get("t"),
                            "close": float(latest.get("close", latest.get("c", 0.0)) or 0.0),
                            "confidence": float(signal.get("confidence") or 0.0),
                        }
                    )

        payload = {
            "symbol": normalized_symbol,
            "pattern": str(pattern or "").strip().lower(),
            "lookback": int(lookback),
            "count": len(occurrences),
            "occurrences": occurrences,
            "meta": {
                "cache_hit": False,
                "bars_scanned": len(candles),
                "min_volume_ratio": float(min_volume_ratio),
            },
        }
        await cache_instance.set(key, payload, ttl=max(10, int(cache_ttl)))
        return payload


_occurrence_service: BreakoutOccurrenceService | None = None


def get_breakout_occurrence_service() -> BreakoutOccurrenceService:
    global _occurrence_service
    if _occurrence_service is None:
        _occurrence_service = BreakoutOccurrenceService()
    return _occurrence_service
