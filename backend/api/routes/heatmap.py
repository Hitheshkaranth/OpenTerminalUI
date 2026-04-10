from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query

from backend.adapters.registry import get_adapter_registry

router = APIRouter()

MarketCode = Literal["IN", "US"]
GroupBy = Literal["sector", "industry"]
PeriodCode = Literal["1d", "1w", "1m", "3m", "ytd", "1y"]
SizeBy = Literal["market_cap", "volume", "turnover"]

_TTL_SECONDS = 300
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


@dataclass(frozen=True)
class HeatmapUniverseRow:
    symbol: str
    name: str
    exchange: str
    sector: str
    industry: str
    market_cap: float


IN_UNIVERSE: tuple[HeatmapUniverseRow, ...] = (
    HeatmapUniverseRow("RELIANCE", "Reliance Industries", "NSE", "Energy", "Integrated Oil & Gas", 240_000_000_000),
    HeatmapUniverseRow("TCS", "Tata Consultancy Services", "NSE", "Technology", "IT Services", 185_000_000_000),
    HeatmapUniverseRow("INFY", "Infosys", "NSE", "Technology", "IT Services", 78_000_000_000),
    HeatmapUniverseRow("HDFCBANK", "HDFC Bank", "NSE", "Financials", "Private Banks", 145_000_000_000),
    HeatmapUniverseRow("ICICIBANK", "ICICI Bank", "NSE", "Financials", "Private Banks", 98_000_000_000),
    HeatmapUniverseRow("SBIN", "State Bank of India", "NSE", "Financials", "Public Banks", 82_000_000_000),
    HeatmapUniverseRow("BHARTIARTL", "Bharti Airtel", "NSE", "Communication Services", "Telecom Services", 96_000_000_000),
    HeatmapUniverseRow("LT", "Larsen & Toubro", "NSE", "Industrials", "Engineering & Construction", 63_000_000_000),
    HeatmapUniverseRow("ITC", "ITC", "NSE", "Consumer Staples", "Tobacco & FMCG", 58_000_000_000),
    HeatmapUniverseRow("SUNPHARMA", "Sun Pharmaceutical", "NSE", "Healthcare", "Pharmaceuticals", 46_000_000_000),
    HeatmapUniverseRow("MARUTI", "Maruti Suzuki", "NSE", "Consumer Discretionary", "Automobiles", 52_000_000_000),
    HeatmapUniverseRow("TITAN", "Titan Company", "NSE", "Consumer Discretionary", "Apparel & Luxury", 38_000_000_000),
)

US_UNIVERSE: tuple[HeatmapUniverseRow, ...] = (
    HeatmapUniverseRow("AAPL", "Apple", "NASDAQ", "Technology", "Consumer Electronics", 3_100_000_000_000),
    HeatmapUniverseRow("MSFT", "Microsoft", "NASDAQ", "Technology", "Software", 3_000_000_000_000),
    HeatmapUniverseRow("NVDA", "NVIDIA", "NASDAQ", "Technology", "Semiconductors", 2_400_000_000_000),
    HeatmapUniverseRow("AMZN", "Amazon", "NASDAQ", "Consumer Discretionary", "Internet Retail", 1_900_000_000_000),
    HeatmapUniverseRow("GOOGL", "Alphabet", "NASDAQ", "Communication Services", "Internet Content", 1_800_000_000_000),
    HeatmapUniverseRow("META", "Meta Platforms", "NASDAQ", "Communication Services", "Internet Content", 1_300_000_000_000),
    HeatmapUniverseRow("BRK.B", "Berkshire Hathaway", "NYSE", "Financials", "Multi-Sector Holdings", 890_000_000_000),
    HeatmapUniverseRow("LLY", "Eli Lilly", "NYSE", "Healthcare", "Pharmaceuticals", 710_000_000_000),
    HeatmapUniverseRow("JPM", "JPMorgan Chase", "NYSE", "Financials", "Money Center Banks", 560_000_000_000),
    HeatmapUniverseRow("XOM", "Exxon Mobil", "NYSE", "Energy", "Integrated Oil & Gas", 510_000_000_000),
    HeatmapUniverseRow("AVGO", "Broadcom", "NASDAQ", "Technology", "Semiconductors", 620_000_000_000),
    HeatmapUniverseRow("TSLA", "Tesla", "NASDAQ", "Consumer Discretionary", "Automobiles", 560_000_000_000),
)


def _period_window(period: PeriodCode) -> tuple[date, date]:
    today = date.today()
    if period == "1d":
        return today - timedelta(days=7), today
    if period == "1w":
        return today - timedelta(days=21), today
    if period == "1m":
        return today - timedelta(days=45), today
    if period == "3m":
        return today - timedelta(days=120), today
    if period == "ytd":
        return date(today.year, 1, 1), today
    return today - timedelta(days=370), today


def _seed(symbol: str) -> int:
    return sum((idx + 1) * ord(ch) for idx, ch in enumerate(symbol.upper()))


def _fallback_snapshot(item: HeatmapUniverseRow, period: PeriodCode) -> dict[str, float]:
    seed = _seed(item.symbol)
    drift = ((seed % 1100) - 550) / 100.0
    multiplier = {
        "1d": 0.35,
        "1w": 0.75,
        "1m": 1.15,
        "3m": 1.85,
        "ytd": 2.25,
        "1y": 3.25,
    }[period]
    change_pct = round(max(-9.5, min(9.5, drift * multiplier)), 2)
    volume = float(250_000 + (seed % 7_500_000))
    price = round(max(12.0, item.market_cap / 1_000_000_000 / 10 + (seed % 200)), 2)
    turnover = round(volume * price, 2)
    return {
        "price": price,
        "change_pct": change_pct,
        "volume": volume,
        "turnover": turnover,
    }


async def _fetch_snapshot(item: HeatmapUniverseRow, period: PeriodCode) -> dict[str, Any]:
    registry = get_adapter_registry()
    fallback = _fallback_snapshot(item, period)
    quote_symbol = item.symbol

    try:
        quote = await registry.invoke(item.exchange, "get_quote", quote_symbol)
    except Exception:
        quote = None

    price = fallback["price"]
    change_pct = fallback["change_pct"]
    volume = fallback["volume"]
    turnover = fallback["turnover"]

    if quote is not None:
        price = float(quote.price)
        if period == "1d":
            change_pct = round(float(quote.change_pct), 2)

    if period != "1d":
        try:
            start, end = _period_window(period)
            history = await registry.invoke(item.exchange, "get_history", quote_symbol, "1d", start, end)
        except Exception:
            history = []
        if history:
            first_close = next((float(c.c) for c in history if float(c.c) > 0), 0.0)
            last_close = float(history[-1].c)
            if first_close > 0:
                change_pct = round(((last_close - first_close) / first_close) * 100.0, 2)
            volume = float(sum(float(c.v or 0.0) for c in history[-20:]) or volume)
            turnover = round(volume * price, 2)

    return {
        "symbol": item.symbol,
        "name": item.name,
        "sector": item.sector,
        "industry": item.industry,
        "market_cap": item.market_cap,
        "price": price,
        "change_pct": change_pct,
        "volume": volume,
        "turnover": turnover,
    }


def _universe_for_market(market: MarketCode) -> tuple[HeatmapUniverseRow, ...]:
    return IN_UNIVERSE if market == "IN" else US_UNIVERSE


def _cache_key(market: str, group: str, period: str, size_by: str) -> str:
    return f"{market}:{group}:{period}:{size_by}"


@router.get("/treemap")
async def heatmap_treemap(
    market: MarketCode = Query(default="IN"),
    group: GroupBy = Query(default="sector"),
    period: PeriodCode = Query(default="1d"),
    size_by: SizeBy = Query(default="market_cap"),
) -> dict[str, Any]:
    key = _cache_key(market, group, period, size_by)
    cached = _CACHE.get(key)
    now = time.time()
    if cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]

    universe = _universe_for_market(market)
    if not universe:
        raise HTTPException(status_code=404, detail=f"No universe available for market {market}")

    rows = await asyncio.gather(*(_fetch_snapshot(item, period) for item in universe))
    groups: dict[str, dict[str, Any]] = {}
    total_size = 0.0
    for row in rows:
        size_value = float(row.get(size_by) or 0.0)
        total_size += size_value
        bucket = str(row.get(group) or "Unknown")
        node = groups.setdefault(
            bucket,
            {
                "name": bucket,
                "group_by": group,
                "size_metric": size_by,
                "value": 0.0,
                "children": [],
            },
        )
        node["value"] += size_value
        child = dict(row)
        child["value"] = size_value
        node["children"].append(child)

    data = {
        "market": market,
        "group": group,
        "period": period,
        "size_by": size_by,
        "total_value": total_size,
        "data": sorted(rows, key=lambda item: float(item.get(size_by) or 0.0), reverse=True),
        "groups": sorted(groups.values(), key=lambda item: float(item.get("value") or 0.0), reverse=True),
    }
    _CACHE[key] = (now, data)
    return data
