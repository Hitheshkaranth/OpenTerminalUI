from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


def _iso_from_ms(ts_ms: int | float | None) -> str:
    if ts_ms is None:
        return datetime.now(timezone.utc).isoformat()
    ts = float(ts_ms)
    if ts > 1e12:
        ts /= 1000.0
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


@dataclass
class _Bucket:
    symbol: str
    funding_rate_8h: float = 0.0
    open_interest_usd: float = 0.0
    long_liquidations_24h: float = 0.0
    short_liquidations_24h: float = 0.0
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        total_liq = self.long_liquidations_24h + self.short_liquidations_24h
        return {
            "symbol": self.symbol,
            "funding_rate_8h": self.funding_rate_8h,
            "open_interest_usd": self.open_interest_usd,
            "long_liquidations_24h": self.long_liquidations_24h,
            "short_liquidations_24h": self.short_liquidations_24h,
            "liquidations_24h": total_liq,
            "updated_at": self.updated_at,
        }


class BinanceDerivativesState:
    def __init__(self) -> None:
        self._buckets: dict[str, _Bucket] = {}

    def reset(self) -> None:
        self._buckets.clear()

    def ingest_event(self, symbol: str, funding_rate_8h: float, liquidation_usd: float, side: str, ts_ms: int | None = None) -> None:
        token = (symbol or "").strip().upper()
        if not token:
            return
        bucket = self._buckets.get(token)
        if bucket is None:
            bucket = _Bucket(symbol=token)
            self._buckets[token] = bucket

        bucket.funding_rate_8h = float(funding_rate_8h)
        bucket.open_interest_usd = max(bucket.open_interest_usd, abs(liquidation_usd) * 65.0)
        if (side or "").strip().lower() == "short":
            bucket.short_liquidations_24h += max(0.0, float(liquidation_usd))
        else:
            bucket.long_liquidations_24h += max(0.0, float(liquidation_usd))
        bucket.updated_at = _iso_from_ms(ts_ms)

    def snapshot(self, limit: int = 40) -> dict[str, Any]:
        items = [b.to_dict() for b in self._buckets.values()]
        items.sort(key=lambda row: row["liquidations_24h"], reverse=True)
        trimmed = items[: max(1, int(limit))]
        totals = {
            "open_interest_usd": sum(float(row["open_interest_usd"]) for row in trimmed),
            "long_liquidations_24h": sum(float(row["long_liquidations_24h"]) for row in trimmed),
            "short_liquidations_24h": sum(float(row["short_liquidations_24h"]) for row in trimmed),
            "liquidations_24h": sum(float(row["liquidations_24h"]) for row in trimmed),
        }
        return {"items": trimmed, "totals": totals, "ts": datetime.now(timezone.utc).isoformat()}


_binance_derivatives_state = BinanceDerivativesState()


def get_binance_derivatives_state() -> BinanceDerivativesState:
    return _binance_derivatives_state
