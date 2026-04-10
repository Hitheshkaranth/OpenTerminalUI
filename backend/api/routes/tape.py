from __future__ import annotations

import inspect
import math
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.adapters.registry import get_adapter_registry
from backend.api.deps import get_chart_provider

router = APIRouter(tags=["tape"])

DEFAULT_LIMIT = 500
MAX_LIMIT = 2_000
TRADES_PER_BAR = 10


class TradeRecord(BaseModel):
    timestamp: str
    price: float
    quantity: int
    value: float
    side: str


class _SyntheticBar(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


def _utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _guess_exchange(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if ":" in normalized:
        return normalized.split(":", 1)[0]
    if normalized.endswith(".NS"):
        return "NSE"
    if normalized.endswith(".BO"):
        return "BSE"
    return "NSE"


def _seed_price(symbol: str) -> float:
    base_prices = {
        "RELIANCE": 2950.0,
        "INFY": 1820.0,
        "TCS": 4100.0,
        "AAPL": 242.0,
        "MSFT": 430.0,
    }
    normalized = symbol.split(":")[-1].removesuffix(".NS").removesuffix(".BO")
    return base_prices.get(normalized, 100.0 + (sum(ord(char) for char in normalized) % 200))


def _fallback_bars(symbol: str, bar_count: int) -> list[_SyntheticBar]:
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    rng = random.Random(f"fallback:{symbol}:{bar_count}")
    price = _seed_price(symbol)
    bars: list[_SyntheticBar] = []
    for offset in range(bar_count, 0, -1):
        timestamp = now.replace(second=0, microsecond=0) - timedelta(minutes=offset)
        open_price = price
        move = rng.uniform(-0.004, 0.004) * max(10.0, price)
        close_price = max(1.0, open_price + move)
        high_price = max(open_price, close_price) + rng.uniform(0.1, 0.8) * max(0.2, price * 0.0015)
        low_price = min(open_price, close_price) - rng.uniform(0.1, 0.8) * max(0.2, price * 0.0015)
        volume = int(rng.uniform(30_000, 250_000))
        bars.append(
            _SyntheticBar(
                timestamp=timestamp,
                open=round(open_price, 2),
                high=round(high_price, 2),
                low=round(low_price, 2),
                close=round(close_price, 2),
                volume=volume,
            )
        )
        price = close_price
    return bars


def _normalized_symbol(symbol: str) -> str:
    raw = symbol.strip().upper()
    if ":" in raw:
        return raw
    exchange = _guess_exchange(raw)
    if exchange in {"NSE", "BSE"}:
        return f"{exchange}:{raw.removesuffix('.NS').removesuffix('.BO')}"
    return raw


async def _maybe_call_recent_trades(adapter: Any, symbol: str, limit: int) -> list[dict[str, Any]]:
    method = getattr(adapter, "get_recent_trades", None)
    if method is None:
        return []
    try:
        result = method(symbol, limit=limit)
        if inspect.isawaitable(result):
            result = await result
    except Exception:
        return []
    if not isinstance(result, list):
        return []
    return [row for row in result if isinstance(row, dict)]


def _coerce_trade_rows(rows: list[dict[str, Any]], limit: int) -> list[TradeRecord]:
    parsed: list[TradeRecord] = []
    previous_price: float | None = None
    for row in rows:
        raw_price = row.get("price") or row.get("last_price") or row.get("ltp")
        raw_qty = row.get("quantity") or row.get("size") or row.get("volume")
        if raw_price is None or raw_qty is None:
            continue
        try:
            price = round(float(raw_price), 2)
            quantity = max(1, int(float(raw_qty)))
        except (TypeError, ValueError):
            continue
        raw_ts = row.get("timestamp") or row.get("ts") or row.get("time")
        if isinstance(raw_ts, (int, float)):
            ts = datetime.fromtimestamp(float(raw_ts), tz=timezone.utc)
        elif isinstance(raw_ts, str):
            try:
                ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
            except ValueError:
                ts = datetime.now(timezone.utc)
        else:
            ts = datetime.now(timezone.utc)
        raw_side = str(row.get("side") or "").lower()
        if raw_side in {"buy", "sell", "neutral"}:
            side = raw_side
        elif previous_price is None:
            side = "neutral"
        elif price > previous_price:
            side = "buy"
        elif price < previous_price:
            side = "sell"
        else:
            side = "neutral"
        previous_price = price
        parsed.append(
            TradeRecord(
                timestamp=_utc_iso(ts),
                price=price,
                quantity=quantity,
                value=round(price * quantity, 2),
                side=side,
            )
        )
    parsed.sort(key=lambda trade: trade.timestamp, reverse=True)
    return parsed[:limit]


async def _fetch_live_trades(symbol: str, limit: int) -> list[TradeRecord]:
    registry = get_adapter_registry()
    exchange = _guess_exchange(symbol)
    normalized_symbol = _normalized_symbol(symbol)
    raw_rows: list[dict[str, Any]] = []
    for adapter in registry.get_chain(exchange):
        rows = await _maybe_call_recent_trades(adapter, normalized_symbol, limit)
        if rows:
            raw_rows = rows
            break
    return _coerce_trade_rows(raw_rows, limit)


def _simulate_bar_trades(symbol: str, bars: list[Any], limit: int) -> list[TradeRecord]:
    trades: list[TradeRecord] = []
    previous_price: float | None = None
    for bar in bars:
        if not all(hasattr(bar, attr) for attr in ("timestamp", "open", "high", "low", "close", "volume")):
            continue
        volume = max(0, int(float(bar.volume)))
        if volume <= 0:
            continue
        bar_ts = bar.timestamp if bar.timestamp.tzinfo else bar.timestamp.replace(tzinfo=timezone.utc)
        bar_seed = int(bar_ts.timestamp())
        rng = random.Random(f"{symbol}:{bar_seed}:{volume}")
        price_low = min(float(bar.low), float(bar.high))
        price_high = max(float(bar.low), float(bar.high))
        trade_count = max(1, min(TRADES_PER_BAR, volume))
        weights = [rng.random() or 0.01 for _ in range(trade_count)]
        weight_total = sum(weights) or float(trade_count)
        remaining_volume = volume
        for index in range(trade_count):
            if index == trade_count - 1:
                quantity = remaining_volume
            else:
                quantity = max(1, int(round(volume * weights[index] / weight_total)))
                max_remaining = remaining_volume - (trade_count - index - 1)
                quantity = min(quantity, max_remaining)
            remaining_volume -= quantity
            fraction = (index + 1) / trade_count
            anchor = float(bar.open) + (float(bar.close) - float(bar.open)) * fraction
            jitter = rng.uniform(-1.0, 1.0) * max(0.01, (price_high - price_low) * 0.35)
            price = round(min(price_high, max(price_low, anchor + jitter)), 2)
            if previous_price is None:
                side = "neutral"
            elif price > previous_price:
                side = "buy"
            elif price < previous_price:
                side = "sell"
            else:
                side = "neutral"
            trade_ts = bar_ts.replace(microsecond=0)
            trade_ts = trade_ts.replace(second=min(59, math.floor((60 / trade_count) * index)))
            previous_price = price
            trades.append(
                TradeRecord(
                    timestamp=_utc_iso(trade_ts),
                    price=price,
                    quantity=quantity,
                    value=round(price * quantity, 2),
                    side=side,
                )
            )
    trades.sort(key=lambda trade: trade.timestamp, reverse=True)
    return trades[:limit]


async def _load_recent_trades(symbol: str, limit: int) -> list[TradeRecord]:
    live_trades = await _fetch_live_trades(symbol, limit)
    if live_trades:
        return live_trades[:limit]

    provider = await get_chart_provider()
    bar_count = max(12, math.ceil(limit / TRADES_PER_BAR) + 4)
    try:
        bars = await provider.get_ohlcv(
            symbol.strip().upper(),
            interval="1m",
            period="7d",
            market_hint=_guess_exchange(symbol),
        )
    except Exception:
        bars = []
    if not bars:
        bars = _fallback_bars(symbol.strip().upper(), bar_count)
    return _simulate_bar_trades(symbol.strip().upper(), bars[-bar_count:], limit)


@router.get("/{symbol}/recent")
async def get_recent_tape(
    symbol: str,
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> dict[str, list[dict[str, Any]]]:
    trades = await _load_recent_trades(symbol, limit)
    return {"trades": [trade.model_dump() for trade in trades]}


@router.get("/{symbol}/summary")
async def get_tape_summary(
    symbol: str,
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> dict[str, float | int]:
    trades = await _load_recent_trades(symbol, limit)
    if not trades:
        raise HTTPException(status_code=404, detail="No tape data available")

    total_volume = sum(trade.quantity for trade in trades)
    buy_volume = sum(trade.quantity for trade in trades if trade.side == "buy")
    sell_volume = sum(trade.quantity for trade in trades if trade.side == "sell")
    avg_trade_size = total_volume / max(1, len(trades))
    large_trade_count = sum(1 for trade in trades if trade.quantity > (avg_trade_size * 2))

    timestamps = [
        datetime.fromisoformat(trade.timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
        for trade in trades
    ]
    newest = max(timestamps)
    oldest = min(timestamps)
    duration_minutes = max((newest - oldest).total_seconds() / 60.0, 1.0)
    trades_per_min = len(trades) / duration_minutes

    return {
        "total_volume": total_volume,
        "buy_volume": buy_volume,
        "sell_volume": sell_volume,
        "buy_pct": round((buy_volume / total_volume) * 100.0, 2) if total_volume else 0.0,
        "large_trade_count": large_trade_count,
        "avg_trade_size": round(avg_trade_size, 2),
        "trades_per_min": round(trades_per_min, 2),
    }
