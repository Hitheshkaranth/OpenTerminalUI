from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any


@dataclass(frozen=True)
class DepthLevel:
    price: float
    size: int
    orders: int


@dataclass(frozen=True)
class DepthSnapshot:
    symbol: str
    market: str
    provider_key: str
    as_of: datetime
    mid_price: float
    spread: float
    tick_size: float
    bids: tuple[DepthLevel, ...]
    asks: tuple[DepthLevel, ...]
    levels: int
    total_bid_quantity: int
    total_ask_quantity: int

    def to_wire(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "market": self.market,
            "provider_key": self.provider_key,
            "as_of": self.as_of.isoformat(),
            "mid_price": self.mid_price,
            "spread": self.spread,
            "tick_size": self.tick_size,
            "levels": self.levels,
            "total_bid_quantity": self.total_bid_quantity,
            "total_ask_quantity": self.total_ask_quantity,
            "bids": [
                {"price": level.price, "size": level.size, "orders": level.orders}
                for level in self.bids
            ],
            "asks": [
                {"price": level.price, "size": level.size, "orders": level.orders}
                for level in self.asks
            ],
        }


class OrderBookService:
    def __init__(self, cache_ttl_seconds: int = 3) -> None:
        self._cache_ttl_seconds = max(1, int(cache_ttl_seconds))
        self._cache: dict[str, tuple[float, DepthSnapshot]] = {}

    @staticmethod
    def _normalize_symbol(symbol: str) -> str:
        normalized = str(symbol or "").strip().upper()
        if not normalized:
            raise ValueError("symbol is required")
        return normalized

    @staticmethod
    def _normalize_market(market_hint: str | None, symbol: str) -> str:
        value = str(market_hint or "").strip().upper()
        if value in {"IN", "NSE", "BSE"}:
            return "IN"
        if value in {"US", "NASDAQ", "NYSE", "AMEX"}:
            return "US"
        if value in {"CRYPTO", "BINANCE", "BTC", "ETH"}:
            return "CRYPTO"
        if symbol.endswith("-USD") or symbol.endswith("USDT") or symbol.endswith("BTC"):
            return "CRYPTO"
        return "US"

    @staticmethod
    def _provider_key_for_market(market: str) -> str:
        if market == "IN":
            return "kite"
        if market == "CRYPTO":
            return "binance"
        if market == "US":
            return "finnhub"
        return "synthetic"

    @staticmethod
    def _seed(symbol: str, market: str, provider_key: str, levels: int) -> int:
        digest = sha256(f"{symbol}:{market}:{provider_key}:{levels}".encode("utf-8")).hexdigest()
        return int(digest[:16], 16)

    @staticmethod
    def _decimal_places(tick_size: float) -> int:
        if tick_size >= 1:
            return 0
        if tick_size >= 0.1:
            return 1
        return 2

    def _build_snapshot(self, symbol: str, market: str, levels: int) -> DepthSnapshot:
        provider_key = self._provider_key_for_market(market)
        seed = self._seed(symbol, market, provider_key, levels)

        if market == "IN":
            base_price = 100.0 + (seed % 75_000) / 10.0
            tick_size = 0.05 if base_price < 1_000 else 0.10
            spread = tick_size * (4 + seed % 3)
        elif market == "CRYPTO":
            base_price = 1_000.0 + (seed % 2_500_000) / 100.0
            tick_size = 0.50 if base_price > 10_000 else 0.10
            spread = tick_size * (12 + seed % 5)
        else:
            base_price = 25.0 + (seed % 18_000) / 100.0
            tick_size = 0.01 if base_price < 25 else 0.05
            spread = tick_size * (6 + seed % 4)

        precision = self._decimal_places(tick_size)
        mid_price = round(base_price, precision)
        bid_anchor = mid_price - spread / 2.0
        ask_anchor = mid_price + spread / 2.0
        created_at = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=seed % 500_000)

        bids: list[DepthLevel] = []
        asks: list[DepthLevel] = []
        total_bid_quantity = 0
        total_ask_quantity = 0

        for index in range(levels):
            level_no = index + 1
            bid_price = round(bid_anchor - index * tick_size, precision)
            ask_price = round(ask_anchor + index * tick_size, precision)
            bid_size = 500 + ((seed >> (index % 16)) % 900) + level_no * 40
            ask_size = 520 + ((seed >> ((index + 5) % 16)) % 920) + level_no * 42
            bid_orders = 1 + ((seed >> ((index + 3) % 16)) % 4)
            ask_orders = 1 + ((seed >> ((index + 7) % 16)) % 4)
            bids.append(DepthLevel(price=bid_price, size=int(bid_size), orders=int(bid_orders)))
            asks.append(DepthLevel(price=ask_price, size=int(ask_size), orders=int(ask_orders)))
            total_bid_quantity += int(bid_size)
            total_ask_quantity += int(ask_size)

        bids.sort(key=lambda row: row.price, reverse=True)
        asks.sort(key=lambda row: row.price)

        spread_value = round(asks[0].price - bids[0].price, precision) if bids and asks else 0.0
        return DepthSnapshot(
            symbol=symbol,
            market=market,
            provider_key=provider_key,
            as_of=created_at,
            mid_price=mid_price,
            spread=spread_value,
            tick_size=tick_size,
            bids=tuple(bids),
            asks=tuple(asks),
            levels=levels,
            total_bid_quantity=total_bid_quantity,
            total_ask_quantity=total_ask_quantity,
        )

    def get_snapshot(self, symbol: str, market_hint: str | None = None, levels: int = 10) -> DepthSnapshot:
        normalized_symbol = self._normalize_symbol(symbol)
        normalized_market = self._normalize_market(market_hint, normalized_symbol)
        safe_levels = max(1, min(int(levels), 25))
        cache_key = f"{normalized_symbol}:{normalized_market}:{safe_levels}"
        now = datetime.now(timezone.utc).timestamp()
        cached = self._cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]

        snapshot = self._build_snapshot(normalized_symbol, normalized_market, safe_levels)
        self._cache[cache_key] = (now + self._cache_ttl_seconds, snapshot)
        return snapshot

    def stream_message(self, symbol: str, market_hint: str | None = None, levels: int = 10) -> dict[str, Any]:
        snapshot = self.get_snapshot(symbol, market_hint=market_hint, levels=levels)
        return {
            "type": "depth",
            "symbol": snapshot.symbol,
            "market": snapshot.market,
            "provider_key": snapshot.provider_key,
            "snapshot": snapshot.to_wire(),
        }


service = OrderBookService()
