from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Callable, Literal


HotlistType = Literal[
    "gainers",
    "losers",
    "most_active",
    "52w_high",
    "52w_low",
    "gap_up",
    "gap_down",
    "unusual_volume",
]
MarketType = Literal["IN", "US"]

VALID_LIST_TYPES: tuple[HotlistType, ...] = (
    "gainers",
    "losers",
    "most_active",
    "52w_high",
    "52w_low",
    "gap_up",
    "gap_down",
    "unusual_volume",
)


@dataclass(frozen=True)
class _UniverseRow:
    symbol: str
    name: str
    market: MarketType
    prev_close: float
    open_price: float
    last_price: float
    volume: int
    avg_volume: int
    high_52w: float
    low_52w: float
    sparkline: tuple[float, ...]


def _seed(*parts: str) -> int:
    digest = sha256("::".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=False)


def _stable_series(base: float, symbol: str, points: int = 5) -> tuple[float, ...]:
    out: list[float] = []
    current = max(0.01, float(base))
    for index in range(points):
        s = _seed(symbol, "spark", str(index))
        move = ((s % 130) - 65) / 5000.0
        current = max(0.01, current * (1.0 + move))
        out.append(round(current, 2))
    return tuple(out)


def _build_market_universe(market: MarketType) -> list[_UniverseRow]:
    if market == "IN":
        base_rows = (
            ("RELIANCE", "Reliance Industries", 2954.0, 2942.0, 3012.0, 6_200_000, 3_900_000),
            ("TCS", "Tata Consultancy Services", 4120.0, 4108.0, 4089.0, 2_100_000, 1_450_000),
            ("INFY", "Infosys", 1782.0, 1774.0, 1811.0, 5_100_000, 2_950_000),
            ("HDFCBANK", "HDFC Bank", 1594.0, 1580.0, 1562.0, 4_300_000, 3_050_000),
            ("ICICIBANK", "ICICI Bank", 1228.0, 1211.0, 1238.0, 5_800_000, 3_300_000),
            ("SBIN", "State Bank of India", 821.0, 826.0, 808.0, 7_900_000, 5_400_000),
            ("LT", "Larsen & Toubro", 3620.0, 3592.0, 3678.0, 1_250_000, 930_000),
            ("ITC", "ITC", 431.0, 430.0, 438.0, 8_450_000, 4_950_000),
            ("BHARTIARTL", "Bharti Airtel", 1315.0, 1298.0, 1336.0, 6_350_000, 3_350_000),
            ("HINDUNILVR", "Hindustan Unilever", 2498.0, 2485.0, 2462.0, 1_680_000, 1_320_000),
        )
    else:
        base_rows = (
            ("AAPL", "Apple Inc.", 224.2, 225.1, 228.8, 69_200_000, 54_000_000),
            ("MSFT", "Microsoft Corp.", 417.3, 416.2, 420.7, 24_800_000, 21_900_000),
            ("NVDA", "NVIDIA Corp.", 907.0, 915.5, 936.2, 62_700_000, 41_500_000),
            ("AMZN", "Amazon.com Inc.", 189.9, 191.2, 188.4, 39_500_000, 32_200_000),
            ("META", "Meta Platforms", 502.2, 499.8, 513.9, 19_600_000, 14_700_000),
            ("GOOGL", "Alphabet Inc.", 171.1, 170.2, 168.7, 33_300_000, 26_200_000),
            ("TSLA", "Tesla Inc.", 197.0, 198.6, 192.8, 83_600_000, 66_800_000),
            ("JPM", "JPMorgan Chase", 198.7, 197.4, 201.5, 12_800_000, 10_600_000),
            ("XOM", "Exxon Mobil", 114.4, 115.6, 117.1, 18_900_000, 14_900_000),
            ("AMD", "Advanced Micro Devices", 178.2, 179.1, 182.5, 52_300_000, 31_400_000),
        )

    out: list[_UniverseRow] = []
    for symbol, name, prev_close, open_price, last_price, volume, avg_volume in base_rows:
        drift_seed = _seed(symbol, market, "drift")
        high_52w = round(max(prev_close, last_price) * (1.08 + (drift_seed % 18) / 100.0), 2)
        low_52w = round(min(prev_close, last_price) * (0.78 - (drift_seed % 7) / 200.0), 2)
        out.append(
            _UniverseRow(
                symbol=symbol,
                name=name,
                market=market,
                prev_close=round(float(prev_close), 2),
                open_price=round(float(open_price), 2),
                last_price=round(float(last_price), 2),
                volume=int(volume),
                avg_volume=int(avg_volume),
                high_52w=max(high_52w, round(last_price, 2)),
                low_52w=min(low_52w, round(last_price, 2)),
                sparkline=_stable_series(prev_close, symbol),
            )
        )
    return out


class HotlistService:
    def __init__(self, *, now_factory: Callable[[], datetime] | None = None) -> None:
        self._now_factory = now_factory or (lambda: datetime.now(timezone.utc))
        self._cache: dict[str, tuple[float, list[dict[str, Any]], str]] = {}
        self._cache_lock = asyncio.Lock()
        self._universes: dict[MarketType, list[_UniverseRow]] = {
            "IN": _build_market_universe("IN"),
            "US": _build_market_universe("US"),
        }

    def _now(self) -> datetime:
        now = self._now_factory()
        if now.tzinfo is None:
            return now.replace(tzinfo=timezone.utc)
        return now.astimezone(timezone.utc)

    def _is_market_hours(self, market: MarketType) -> bool:
        now = self._now()
        weekday = now.weekday()
        if weekday >= 5:
            return False
        # Approximation in UTC for deterministic local behavior:
        # IN regular hours roughly 03:45-10:15 UTC, US regular hours roughly 14:30-21:00 UTC.
        minutes = now.hour * 60 + now.minute
        if market == "IN":
            return 225 <= minutes <= 615
        return 870 <= minutes <= 1260

    def _ttl_seconds(self, market: MarketType) -> int:
        return 5 if self._is_market_hours(market) else 300

    def _validate(self, list_type: str, market: str, limit: int) -> tuple[HotlistType, MarketType, int]:
        normalized_type = str(list_type or "").strip().lower()
        if normalized_type not in VALID_LIST_TYPES:
            raise ValueError(f"unsupported list_type: {list_type}")
        normalized_market = str(market or "").strip().upper()
        if normalized_market not in {"IN", "US"}:
            raise ValueError(f"unsupported market: {market}")
        safe_limit = max(1, min(int(limit), 50))
        return normalized_type, normalized_market, safe_limit

    def _row_to_item(self, row: _UniverseRow) -> dict[str, Any]:
        change = round(row.last_price - row.prev_close, 2)
        change_pct = round((change / row.prev_close) * 100.0, 2) if row.prev_close else 0.0
        return {
            "symbol": row.symbol,
            "name": row.name,
            "price": round(row.last_price, 2),
            "change": change,
            "change_pct": change_pct,
            "volume": int(row.volume),
            "sparkline": [float(v) for v in row.sparkline],
            "_prev_close": row.prev_close,
            "_open": row.open_price,
            "_avg_volume": row.avg_volume,
            "_high_52w": row.high_52w,
            "_low_52w": row.low_52w,
        }

    def _rank(self, list_type: HotlistType, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if list_type == "gainers":
            ranked = sorted(rows, key=lambda row: row["change_pct"], reverse=True)
        elif list_type == "losers":
            ranked = sorted(rows, key=lambda row: row["change_pct"])
        elif list_type == "most_active":
            ranked = sorted(rows, key=lambda row: row["volume"], reverse=True)
        elif list_type == "52w_high":
            ranked = sorted(rows, key=lambda row: (row["price"] / row["_high_52w"]) if row["_high_52w"] else 0.0, reverse=True)
        elif list_type == "52w_low":
            ranked = sorted(rows, key=lambda row: (row["price"] / row["_low_52w"]) if row["_low_52w"] else float("inf"))
        elif list_type == "gap_up":
            ranked = sorted(
                rows,
                key=lambda row: ((row["_open"] - row["_prev_close"]) / row["_prev_close"]) if row["_prev_close"] else 0.0,
                reverse=True,
            )
        elif list_type == "gap_down":
            ranked = sorted(
                rows,
                key=lambda row: ((row["_open"] - row["_prev_close"]) / row["_prev_close"]) if row["_prev_close"] else 0.0,
            )
        else:
            ranked = sorted(
                rows,
                key=lambda row: (row["volume"] / row["_avg_volume"]) if row["_avg_volume"] else 0.0,
                reverse=True,
            )
        return ranked

    async def get_hotlist(self, list_type: str, market: str = "IN", limit: int = 20) -> list[dict[str, Any]]:
        normalized_type, normalized_market, safe_limit = self._validate(list_type, market, limit)
        now = self._now()
        cache_key = f"{normalized_market}:{normalized_type}:{safe_limit}"

        async with self._cache_lock:
            cached = self._cache.get(cache_key)
            if cached and cached[0] > now.timestamp():
                return copy.deepcopy(cached[1])

        universe = self._universes[normalized_market]
        rows = [self._row_to_item(row) for row in universe]
        ranked = self._rank(normalized_type, rows)[:safe_limit]
        final = [
            {
                "symbol": row["symbol"],
                "name": row["name"],
                "price": row["price"],
                "change": row["change"],
                "change_pct": row["change_pct"],
                "volume": row["volume"],
                "sparkline": row["sparkline"],
            }
            for row in ranked
        ]

        ttl = self._ttl_seconds(normalized_market)
        async with self._cache_lock:
            self._cache[cache_key] = (now.timestamp() + ttl, copy.deepcopy(final), now.isoformat())
        return final


_SERVICE = HotlistService()


def get_hotlist_service() -> HotlistService:
    return _SERVICE
