from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml

from backend.shared.cache import cache as cache_instance

# OWNER: agent F
# Equal-weight buy-and-hold thematic index. The index level at each trading day t
# is 100 * mean_i(close_i,t / close_i,0) over members that have data, rebased so
# the first available common day is 100; the benchmark is rebased to 100 too.

_SESSIONS = {"1m": 21, "3m": 63, "6m": 126}
_CACHE_TTL_SECONDS = 15 * 60

_YAML_PATHS = (
    Path(__file__).resolve().parent / "themes.yaml",
    Path(__file__).resolve().parents[1] / "themes.yaml",
)

_themes_cache: Optional[list[dict[str, Any]]] = None


def load_themes() -> list[dict[str, Any]]:
    global _themes_cache
    if _themes_cache is not None:
        return _themes_cache

    for candidate in _YAML_PATHS:
        if candidate.exists():
            try:
                with open(candidate, encoding="utf-8") as fh:
                    doc = yaml.safe_load(fh)
                raw = (doc or {}).get("themes")
                if isinstance(raw, list):
                    _themes_cache = [t for t in raw if isinstance(t, dict) and t.get("id")]
                    return _themes_cache
            except (OSError, yaml.YAMLError):
                pass
    _themes_cache = []
    return _themes_cache


def find_theme(theme_id: str, market: Optional[str] = None) -> Optional[dict[str, Any]]:
    for theme in load_themes():
        if str(theme.get("id")).lower() == str(theme_id).strip().lower():
            if market is None or str(theme.get("market")).upper() == str(market).upper():
                return theme
    return None


def list_by_market(market: str) -> list[dict[str, Any]]:
    return [t for t in load_themes() if str(t.get("market")).upper() == str(market).upper()]


def _to_float(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
        return out if out == out else None
    except (TypeError, ValueError):
        return None


def _round_or_none(value: Optional[float], ndigits: int) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), ndigits)


def _extract_closes(payload: Any) -> list[tuple[date, float]]:
    """Pull (calendar date, close) pairs out of a unified-fetcher chart payload.

    Keyed by calendar date, not timestamp: index and stock bars are often stamped at
    different times of day, and exact-timestamp joins left index and benchmark on
    alternating rows.
    """
    if not isinstance(payload, dict):
        return []
    result = (payload.get("chart") or {}).get("result")
    if not isinstance(result, list) or not result:
        return []
    node = result[0] or {}
    timestamps = node.get("timestamp") or []
    closes: list[Any] = []
    for q in (node.get("indicators") or {}).get("quote") or []:
        if isinstance(q, dict) and q.get("close"):
            closes = q["close"]
            break
    by_day: dict[date, float] = {}
    for raw_ts, raw_close in zip(timestamps, closes):
        value = _to_float(raw_close)
        if value is None or value <= 0:
            continue
        try:
            day = datetime.fromtimestamp(int(raw_ts), tz=timezone.utc).date()
        except (TypeError, ValueError, OSError):
            continue
        by_day[day] = value  # last bar of the day wins
    return sorted(by_day.items())


def _constituents(theme: dict[str, Any]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for item in theme.get("constituents") or []:
        if isinstance(item, dict) and str(item.get("symbol") or "").strip():
            sym = str(item["symbol"]).strip()
            out.append((sym, str(item.get("name") or sym)))
        elif isinstance(item, str) and item.strip():
            out.append((item.strip(), item.strip()))
    return out


def index_from_members(
    members: list[tuple[str, str, list[tuple[date, float]]]],
) -> tuple[list[tuple[date, float]], list[dict[str, Any]], list[str]]:
    """Equal-weight buy-and-hold index: 100 × mean_i(close_i,t / close_i,base).

    The base date is the latest of the members' first dates, so every included member
    has a base price. Members are forward-filled across non-trading days so a single
    missing bar does not change the basket's composition for that day.
    """
    total = len(members)
    weight = round(1.0 / total, 4) if total else None
    warnings: list[str] = []
    members_out = [
        {"symbol": s, "name": n, "weight": weight, "last": _round_or_none(pts[-1][1] if pts else None, 2),
         "return_1y": _round_or_none(_total_return(pts), 2)}
        for s, n, pts in members
    ]
    nonempty = [(s, n, pts) for s, n, pts in members if pts]
    for s, _n, pts in members:
        if not pts:
            warnings.append(f"Constituent {s}: no usable price history; excluded from the index.")
    if not nonempty:
        return [], members_out, warnings or ["No constituents with price data to build the index."]

    base_date = max(pts[0][0] for _, _, pts in nonempty)
    days = sorted({d for _, _, pts in nonempty for d, _ in pts if d >= base_date})
    filled: list[list[float]] = []
    for _s, _n, pts in nonempty:
        dmap = dict(pts)
        base = next((v for d, v in reversed(pts) if d <= base_date), None)
        if not base:
            continue
        row, last = [], base
        for d in days:
            last = dmap.get(d, last)
            row.append(last / base)
        filled.append(row)
    series = [(d, 100.0 * sum(r[i] for r in filled) / len(filled)) for i, d in enumerate(days)]
    return series, members_out, warnings


def _total_return(points: list[tuple[date, float]]) -> Optional[float]:
    if len(points) < 2 or not points[0][1]:
        return None
    return (points[-1][1] / points[0][1] - 1.0) * 100.0


def index_returns(points: list[tuple[date, float]], windows: dict[str, Optional[int]]) -> dict[str, Optional[float]]:
    values = [v for _, v in points]
    out: dict[str, Optional[float]] = {}
    for name, count in windows.items():
        if count is None:
            out[name] = _round_or_none(_safe_pct(values, 0, len(values) - 1), 2) if len(values) >= 2 else None
        elif len(values) > count:
            out[name] = _round_or_none(_safe_pct(values, len(values) - 1 - count, len(values) - 1), 2)
        else:
            out[name] = None
    return out


def _safe_pct(values: list[float], from_idx: int, to_idx: int) -> Optional[float]:
    base = values[from_idx]
    return None if not base else (values[to_idx] / base - 1.0) * 100.0


def rebase_benchmark(benchmark: list[tuple[date, float]], start: date) -> list[tuple[date, float]]:
    """Benchmark rebased to 100 on the index's base date, so both lines start together."""
    window = [(d, v) for d, v in benchmark if d >= start]
    base = next((v for d, v in reversed(benchmark) if d <= start), window[0][1] if window else None)
    if not base:
        return []
    return [(d, 100.0 * v / base) for d, v in window]


async def get_unified_fetcher():
    # Module-level hook so tests can swap the fetcher.
    from backend.api.deps import get_unified_fetcher as _real

    return await _real()


_FETCH_CONCURRENCY = 6


async def fetch_theme_data(fetcher: Any, market: str, theme_id: str) -> Optional[dict[str, Any]]:
    """Assemble the full theme document (summary + series + members)."""
    theme = find_theme(theme_id, market)
    if theme is None:
        return None
    market_label = str(theme.get("market", market)).upper()
    benchmark = str(theme.get("benchmark", "")).strip()
    constituents = _constituents(theme)
    sem = asyncio.Semaphore(_FETCH_CONCURRENCY)

    async def closes_for(symbol: str) -> list[tuple[date, float]]:
        async with sem:
            try:
                return _extract_closes(await fetcher.fetch_history(symbol, "1y", "1d"))
            except Exception:
                return []

    results = await asyncio.gather(closes_for(benchmark) if benchmark else asyncio.sleep(0, []),
                                   *(closes_for(s) for s, _ in constituents))
    benchmark_closes, member_closes = results[0] or [], results[1:]
    members = [(s, n, pts) for (s, n), pts in zip(constituents, member_closes)]

    index_points, members_out, warnings = index_from_members(members)
    bench_points = rebase_benchmark(benchmark_closes, index_points[0][0]) if index_points and benchmark_closes else []
    if not benchmark_closes:
        warnings.append(f"Benchmark {benchmark or 'unspecified'} has no usable price history; benchmark returns are unavailable.")

    windows = {**_SESSIONS, "1y": None}
    index_ret = index_returns(index_points, windows)
    bench_ret = index_returns(bench_points, windows)
    bench_map = dict(bench_points)
    return {
        "id": theme["id"],
        "name": str(theme.get("name", "")),
        "description": str(theme.get("description", "")),
        "market": market_label,
        "constituents": len(constituents),
        "return_1m": index_ret.get("1m"),
        "return_3m": index_ret.get("3m"),
        "return_6m": index_ret.get("6m"),
        "return_1y": index_ret.get("1y"),
        "vs_benchmark_1y": (
            _round_or_none(index_ret["1y"] - bench_ret["1y"], 2)
            if index_ret.get("1y") is not None and bench_ret.get("1y") is not None else None
        ),
        "benchmark": benchmark or None,
        "series": [
            {"date": d.isoformat(), "index": round(v, 2), "benchmark": _round_or_none(bench_map.get(d), 2)}
            for d, v in index_points
        ],
        "members": members_out,
        "warnings": warnings,
    }


async def get_cached_theme_data(market: str, theme_id: str) -> Optional[dict[str, Any]]:
    """Cache the full computed theme document for 15 minutes."""
    key = cache_instance.build_key("theme", f"{str(market).upper()}:{theme_id}", {})

    cached = await cache_instance.get(key)
    if isinstance(cached, dict) and cached.get("id") is not None:
        return cached

    fetcher = await get_unified_fetcher()
    data = await fetch_theme_data(fetcher, market, theme_id)
    if isinstance(data, dict) and data.get("id") is not None:
        await cache_instance.set(key, data, ttl=_CACHE_TTL_SECONDS)
    return data