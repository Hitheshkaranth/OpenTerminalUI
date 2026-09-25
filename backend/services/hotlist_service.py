from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Literal


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


_UNIVERSE_NAMES: dict[MarketType, tuple[tuple[str, str], ...]] = {
    "IN": (
        ("RELIANCE", "Reliance Industries"),
        ("TCS", "Tata Consultancy Services"),
        ("INFY", "Infosys"),
        ("HDFCBANK", "HDFC Bank"),
        ("ICICIBANK", "ICICI Bank"),
        ("SBIN", "State Bank of India"),
        ("LT", "Larsen & Toubro"),
        ("ITC", "ITC"),
        ("BHARTIARTL", "Bharti Airtel"),
        ("HINDUNILVR", "Hindustan Unilever"),
    ),
    "US": (
        ("AAPL", "Apple Inc."),
        ("MSFT", "Microsoft Corp."),
        ("NVDA", "NVIDIA Corp."),
        ("AMZN", "Amazon.com Inc."),
        ("META", "Meta Platforms"),
        ("GOOGL", "Alphabet Inc."),
        ("TSLA", "Tesla Inc."),
        ("JPM", "JPMorgan Chase"),
        ("XOM", "Exxon Mobil"),
        ("AMD", "Advanced Micro Devices"),
    ),
}

# A bar is (open, high, low, close, volume), oldest first.
Bar = tuple[float, float, float, float, float]
HistoryLoader = Callable[[str, MarketType], Awaitable[list[Bar]]]


async def _default_history_loader(symbol: str, market: MarketType) -> list[Bar]:
    """Daily bars (1y) from the real provider chain (adapters -> Yahoo -> FMP)."""
    from backend.api.deps import get_unified_fetcher
    from backend.api.routes.chart import _parse_yahoo_chart

    fetcher = await get_unified_fetcher()
    raw = await fetcher.fetch_history(symbol, range_str="1y", interval="1d")
    frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
    if frame.empty:
        return []
    frame = frame.sort_index()
    return [
        (float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"]), float(r.get("Volume", 0.0) or 0.0))
        for _, r in frame.iterrows()
    ]


def _row_from_bars(symbol: str, name: str, market: MarketType, bars: list[Bar]) -> _UniverseRow | None:
    bars = [b for b in bars if b[3] and b[3] > 0]
    if len(bars) < 2:
        return None
    last = bars[-1]
    prev = bars[-2]
    history = bars[-21:-1] or bars[:-1]
    avg_volume = int(sum(b[4] for b in history) / len(history)) if history else 0
    return _UniverseRow(
        symbol=symbol,
        name=name,
        market=market,
        prev_close=round(prev[3], 2),
        open_price=round(last[0], 2),
        last_price=round(last[3], 2),
        volume=int(last[4]),
        avg_volume=avg_volume,
        high_52w=round(max(b[1] for b in bars), 2),
        low_52w=round(min(b[2] for b in bars), 2),
        sparkline=tuple(round(b[3], 2) for b in bars[-5:]),
    )


class HotlistService:
    def __init__(
        self,
        *,
        now_factory: Callable[[], datetime] | None = None,
        history_loader: HistoryLoader | None = None,
    ) -> None:
        self._now_factory = now_factory or (lambda: datetime.now(timezone.utc))
        self._history_loader = history_loader or _default_history_loader
        self._cache: dict[str, tuple[float, list[dict[str, Any]], str]] = {}
        self._cache_lock = asyncio.Lock()
        self._universe_cache: dict[str, tuple[float, list[_UniverseRow]]] = {}

    async def _load_universe(self, market: MarketType) -> list[_UniverseRow]:
        now_ts = self._now().timestamp()
        cached = self._universe_cache.get(market)
        if cached and cached[0] > now_ts:
            return list(cached[1])

        async def _one(symbol: str, name: str) -> _UniverseRow | None:
            try:
                bars = await asyncio.wait_for(self._history_loader(symbol, market), timeout=15)
            except Exception:
                return None
            return _row_from_bars(symbol, name, market, bars or [])

        results = await asyncio.gather(*(_one(sym, name) for sym, name in _UNIVERSE_NAMES[market]))
        rows = [row for row in results if row is not None]
        if rows:
            self._universe_cache[market] = (now_ts + self._ttl_seconds(market), rows)
        return rows

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
            ranked = sorted((r for r in rows if r["change_pct"] > 0), key=lambda row: row["change_pct"], reverse=True)
        elif list_type == "losers":
            ranked = sorted((r for r in rows if r["change_pct"] < 0), key=lambda row: row["change_pct"])
        elif list_type == "most_active":
            ranked = sorted(rows, key=lambda row: row["volume"], reverse=True)
        elif list_type == "52w_high":
            ranked = sorted(rows, key=lambda row: (row["price"] / row["_high_52w"]) if row["_high_52w"] else 0.0, reverse=True)
        elif list_type == "52w_low":
            ranked = sorted(rows, key=lambda row: (row["price"] / row["_low_52w"]) if row["_low_52w"] else float("inf"))
        elif list_type == "gap_up":
            ranked = sorted(
                (r for r in rows if r["_open"] > r["_prev_close"]),
                key=lambda row: ((row["_open"] - row["_prev_close"]) / row["_prev_close"]) if row["_prev_close"] else 0.0,
                reverse=True,
            )
        elif list_type == "gap_down":
            ranked = sorted(
                (r for r in rows if r["_open"] < r["_prev_close"]),
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

        universe = await self._load_universe(normalized_market)
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

        ttl = self._ttl_seconds(normalized_market) if universe else 0
        async with self._cache_lock:
            self._cache[cache_key] = (now.timestamp() + ttl, copy.deepcopy(final), now.isoformat())
        return final


_SERVICE = HotlistService()


def get_hotlist_service() -> HotlistService:
    return _SERVICE
