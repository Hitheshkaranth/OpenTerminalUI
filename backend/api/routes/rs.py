from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable

from fastapi import APIRouter

router = APIRouter()

# Daily closes/highs (oldest first) for a symbol; empty when the provider has no data.
Series = list[tuple[str, float, float]]  # (date, close, high)
HistoryLoader = Callable[[str], Awaitable[Series]]

BENCHMARK = "^NSEI"
_SECTOR_INDICES: dict[str, str] = {
    "IT": "^CNXIT",
    "Banking": "^NSEBANK",
    "Energy": "^CNXENERGY",
    "FMCG": "^CNXFMCG",
    "Pharma": "^CNXPHARMA",
    "Auto": "^CNXAUTO",
    "Metal": "^CNXMETAL",
    "Realty": "^CNXREALTY",
}
_CACHE_TTL_SECONDS = 900
_cache: dict[str, tuple[float, Any]] = {}


async def _default_loader(symbol: str) -> Series:
    from backend.api.deps import get_unified_fetcher
    from backend.api.routes.chart import _parse_yahoo_chart

    fetcher = await get_unified_fetcher()
    raw = await fetcher.fetch_history(symbol, range_str="2y", interval="1d")
    frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
    if frame.empty:
        return []
    frame = frame.sort_index()
    return [(idx.strftime("%Y-%m-%d"), float(r["Close"]), float(r["High"])) for idx, r in frame.iterrows()]


_loader: HistoryLoader = _default_loader


def _universe(name: str) -> list[str]:
    from backend.services.prefetch_worker import NIFTY_50

    key = "".join(ch for ch in name.lower() if ch.isalnum())
    if key in {"nifty50", "nifty"}:
        return list(NIFTY_50)
    return []


def _ret(closes: list[float], lookback: int, offset: int = 0) -> float | None:
    end = len(closes) - 1 - offset
    start = end - lookback
    if start < 0 or end < 0 or closes[start] <= 0:
        return None
    return closes[end] / closes[start] - 1.0


def _weighted_strength(closes: list[float], offset: int = 0) -> float | None:
    """IBD-style strength: 40% last quarter + 20% each of the three prior quarters' cumulative returns."""
    r3 = _ret(closes, 63, offset)
    if r3 is None:
        return None
    parts = [(r3, 0.4)]
    for lb in (126, 189, 252):
        r = _ret(closes, lb, offset)
        if r is not None:
            parts.append((r, 0.2))
    total_w = sum(w for _, w in parts)
    return sum(r * w for r, w in parts) / total_w


def _percentile_scores(values: dict[str, float]) -> dict[str, int]:
    ordered = sorted(values, key=lambda k: values[k])
    n = len(ordered)
    if n == 1:
        return {ordered[0]: 50}
    return {sym: int(round(1 + 98 * i / (n - 1))) for i, sym in enumerate(ordered)}


async def _load_many(symbols: list[str]) -> dict[str, Series]:
    sem = asyncio.Semaphore(8)

    async def _one(sym: str) -> tuple[str, Series]:
        cached = _cache.get(f"h:{sym}")
        if cached and cached[0] > time.time():
            return sym, cached[1]
        async with sem:
            try:
                series = await asyncio.wait_for(_loader(sym), timeout=20)
            except Exception:
                series = []
        if series:
            _cache[f"h:{sym}"] = (time.time() + _CACHE_TTL_SECONDS, series)
        return sym, series

    results = await asyncio.gather(*(_one(s) for s in symbols))
    return {sym: series for sym, series in results if series}


async def _rankings(universe: str) -> list[dict[str, Any]]:
    histories = await _load_many(_universe(universe))
    now_vals: dict[str, float] = {}
    prev_vals: dict[str, float] = {}
    for sym, series in histories.items():
        closes = [c for _, c, _ in series]
        cur = _weighted_strength(closes)
        if cur is not None:
            now_vals[sym] = cur
        prev = _weighted_strength(closes, offset=21)
        if prev is not None:
            prev_vals[sym] = prev
    if not now_vals:
        return []
    scores = _percentile_scores(now_vals)
    prev_order = sorted(prev_vals, key=lambda k: -prev_vals[k])
    prev_rank = {sym: i + 1 for i, sym in enumerate(prev_order)}
    ordered = sorted(now_vals, key=lambda k: -now_vals[k])
    rows = []
    for i, sym in enumerate(ordered):
        series = histories[sym]
        rows.append({
            "symbol": sym,
            "rs_score": scores[sym],
            "rank": i + 1,
            "prev_rank": prev_rank.get(sym),
            "return_3m_pct": round((_ret([c for _, c, _ in series], 63) or 0.0) * 100, 2),
            "price": round(series[-1][1], 2),
            "high_52w": round(max(h for _, _, h in series[-252:]), 2),
            "as_of": series[-1][0],
        })
    return rows


@router.get("/rs/rankings")
async def get_rs_rankings(universe: str = "Nifty 50"):
    """RS rankings (1-99 percentile of weighted 3/6/9/12-month returns) computed from real price history."""
    return await _rankings(universe)


@router.get("/rs/sector-rs")
async def get_sector_rs():
    """RS scores for NSE sector indices, computed from real index history."""
    histories = await _load_many(list(_SECTOR_INDICES.values()))
    vals: dict[str, float] = {}
    for sector, idx in _SECTOR_INDICES.items():
        series = histories.get(idx)
        if not series:
            continue
        strength = _weighted_strength([c for _, c, _ in series])
        if strength is not None:
            vals[sector] = strength
    if not vals:
        return []
    scores = _percentile_scores(vals)
    return sorted(({"sector": s, "rs_score": scores[s]} for s in vals), key=lambda r: -r["rs_score"])


@router.get("/rs/chart/{symbol}")
async def get_rs_chart_data(symbol: str, benchmark: str = "NIFTY50"):
    """RS line (price / benchmark, rebased to 100) over the last ~6 months from real history."""
    bench_symbol = BENCHMARK if benchmark.upper().replace(" ", "") in {"NIFTY50", "NIFTY", "^NSEI"} else benchmark
    histories = await _load_many([symbol.strip().upper(), bench_symbol])
    stock = histories.get(symbol.strip().upper())
    bench = histories.get(bench_symbol)
    if not stock or not bench:
        return []
    bench_by_date = {d: c for d, c, _ in bench}
    joined = [(d, c, bench_by_date[d]) for d, c, _ in stock if d in bench_by_date and bench_by_date[d] > 0][-126:]
    if not joined:
        return []
    base = joined[0][1] / joined[0][2]
    return [{"date": d, "rs_line": round((c / b) / base * 100.0, 2), "price": round(c, 2)} for d, c, b in joined]


@router.get("/rs/new-highs")
async def get_rs_new_highs(universe: str = "Nifty 50", min_rs: int = 80):
    """Stocks within 2% of their 52-week high with RS score >= min_rs."""
    rows = await _rankings(universe)
    return [
        {"symbol": r["symbol"], "price": r["price"], "rs_score": r["rs_score"], "high_52w": r["high_52w"]}
        for r in rows
        if r["rs_score"] >= min_rs and r["high_52w"] and r["price"] >= 0.98 * r["high_52w"]
    ]
