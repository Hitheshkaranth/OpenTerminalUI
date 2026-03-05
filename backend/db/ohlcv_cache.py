from __future__ import annotations

import asyncio
import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from backend.config.settings import get_settings
from backend.shared.sqlite_utils import configure_sqlite_connection

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS ohlcv_cache (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    ts INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL DEFAULT 0,
    fetched_at REAL NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (symbol, interval, ts)
);
CREATE INDEX IF NOT EXISTS idx_ohlcv_cache_lookup
ON ohlcv_cache(symbol, interval, ts);
"""


def _sqlite_file_from_url(sqlite_url: str) -> Path:
    if sqlite_url.startswith("sqlite:////"):
        return Path(sqlite_url.removeprefix("sqlite:////")).resolve()
    if sqlite_url.startswith("sqlite:///"):
        return Path(sqlite_url.removeprefix("sqlite:///")).resolve()
    if sqlite_url.startswith("sqlite://"):
        return Path(sqlite_url.removeprefix("sqlite://")).resolve()
    return Path("./backend/openterminalui.db").resolve()


def _interval_ms(interval: str) -> int | None:
    key = (interval or "").strip().lower()
    mapping = {
        "1m": 60_000,
        "2m": 120_000,
        "3m": 180_000,
        "5m": 300_000,
        "15m": 900_000,
        "30m": 1_800_000,
        "1h": 3_600_000,
        "60m": 3_600_000,
        "4h": 14_400_000,
        "1d": 86_400_000,
        "1wk": 604_800_000,
        "1mo": 2_592_000_000,
    }
    return mapping.get(key)


def _expected_timestamps(start_ms: int, end_ms: int, interval: str) -> list[int]:
    step = _interval_ms(interval)
    if step is None or end_ms < start_ms:
        return []
    out: list[int] = []
    ts = int(start_ms)
    while ts <= end_ms:
        out.append(ts)
        ts += step
    return out


def _rows_cover_range(rows: list[dict[str, Any]], start_ms: int, end_ms: int, interval: str) -> bool:
    expected = _expected_timestamps(start_ms, end_ms, interval)
    if not expected:
        return bool(rows)
    present = {int(r["t"]) for r in rows}
    return all(ts in present for ts in expected)


def _missing_ranges(rows: list[dict[str, Any]], start_ms: int, end_ms: int, interval: str) -> list[tuple[int, int]]:
    expected = _expected_timestamps(start_ms, end_ms, interval)
    if not expected:
        return []
    present = {int(r["t"]) for r in rows}
    missing = [ts for ts in expected if ts not in present]
    if not missing:
        return []
    step = _interval_ms(interval) or 60_000
    ranges: list[tuple[int, int]] = []
    run_start = missing[0]
    prev = missing[0]
    for ts in missing[1:]:
        if ts - prev != step:
            ranges.append((run_start, prev))
            run_start = ts
        prev = ts
    ranges.append((run_start, prev))
    return ranges


@dataclass
class OHLCVRangeResult:
    rows: list[dict[str, Any]]
    tier: str
    complete: bool
    missing_ranges: list[tuple[int, int]]


class OHLCVCache:
    def __init__(
        self,
        *,
        sqlite_path: Path | None = None,
        cold_root: Path | None = None,
        hot_ttl_seconds: int = 300,
        warm_ttl_seconds: int = 86_400,
    ) -> None:
        settings = get_settings()
        self.sqlite_path = sqlite_path or _sqlite_file_from_url(settings.sqlite_url)
        self.cold_root = cold_root or Path(os.getenv("OHLCV_COLD_ROOT", "data/bars"))
        env_hot_ttl = int(os.getenv("OHLCV_HOT_TTL_SECONDS", str(hot_ttl_seconds)) or hot_ttl_seconds)
        env_warm_ttl = int(os.getenv("OHLCV_WARM_TTL_SECONDS", str(warm_ttl_seconds)) or warm_ttl_seconds)
        self.hot_ttl_seconds = max(1, int(env_hot_ttl))
        self.warm_ttl_seconds = max(1, int(env_warm_ttl))
        self._init_lock = asyncio.Lock()
        self._ready = False
        self._sqlite_available = True
        # hot tier: (symbol, interval) -> (expiry, rows_by_ts)
        self._hot_rows: dict[tuple[str, str], tuple[float, dict[int, dict[str, float | int]]]] = {}
        # fallback when sqlite unavailable
        self._mem_rows: dict[tuple[str, str], dict[int, dict[str, float | int]]] = {}

    async def initialize(self) -> None:
        async with self._init_lock:
            if self._ready:
                return
            try:
                self.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
                self.cold_root.mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(self._initialize_sync)
                self._sqlite_available = True
            except Exception:
                self._sqlite_available = False
            self._ready = True

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.sqlite_path), check_same_thread=False, timeout=15)
        configure_sqlite_connection(conn)
        return conn

    def _initialize_sync(self) -> None:
        with self._connect() as conn:
            conn.executescript(CREATE_TABLE)
            conn.commit()

    async def get_range(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        result = await self.get_range_with_gaps(symbol=symbol, interval=interval, start_ms=start_ms, end_ms=end_ms)
        return result.rows

    async def get_range_with_gaps(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> OHLCVRangeResult:
        await self.initialize()
        symbol_upper = symbol.upper()
        # Hot tier
        hot_rows = self._get_hot(symbol_upper, interval, start_ms, end_ms)
        if hot_rows and _rows_cover_range(hot_rows, start_ms, end_ms, interval):
            return OHLCVRangeResult(rows=hot_rows, tier="hot", complete=True, missing_ranges=[])

        # Warm tier (SQLite / memory fallback)
        warm_rows: list[dict[str, Any]]
        if self._sqlite_available:
            try:
                warm_rows = await asyncio.to_thread(self._get_range_sync, symbol_upper, interval, start_ms, end_ms)
            except Exception:
                self._sqlite_available = False
                warm_rows = self._get_range_mem(symbol_upper, interval, start_ms, end_ms)
        else:
            warm_rows = self._get_range_mem(symbol_upper, interval, start_ms, end_ms)

        rows = self._merge_rows(hot_rows, warm_rows)
        if rows and _rows_cover_range(rows, start_ms, end_ms, interval):
            self._set_hot(symbol_upper, interval, rows)
            return OHLCVRangeResult(rows=rows, tier="warm", complete=True, missing_ranges=[])

        # Cold tier (Parquet by year)
        cold_rows = await asyncio.to_thread(self._read_cold_range_sync, symbol_upper, interval, start_ms, end_ms)
        rows = self._merge_rows(rows, cold_rows)
        self._set_hot(symbol_upper, interval, rows)
        missing = _missing_ranges(rows, start_ms, end_ms, interval)
        return OHLCVRangeResult(rows=rows, tier="cold", complete=(len(missing) == 0), missing_ranges=missing)

    async def put_bars(self, symbol: str, interval: str, bars: list[dict[str, Any]]) -> None:
        if not bars:
            return
        await self.initialize()
        symbol_upper = symbol.upper()
        normalized = self._normalize_rows(bars)
        if not normalized:
            return
        self._set_hot(symbol_upper, interval, normalized)
        if not self._sqlite_available:
            self._put_bars_mem(symbol_upper, interval, normalized)
            await asyncio.to_thread(self._promote_cold_sync, symbol_upper, interval, normalized)
            return
        try:
            await asyncio.to_thread(self._put_bars_sync, symbol_upper, interval, normalized)
        except Exception:
            self._sqlite_available = False
            self._put_bars_mem(symbol_upper, interval, normalized)
        await asyncio.to_thread(self._promote_cold_sync, symbol_upper, interval, normalized)

    def _normalize_rows(self, bars: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for b in bars:
            if not all(k in b for k in ("t", "o", "h", "l", "c")):
                continue
            out.append(
                {
                    "t": int(b["t"]),
                    "o": float(b["o"]),
                    "h": float(b["h"]),
                    "l": float(b["l"]),
                    "c": float(b["c"]),
                    "v": float(b.get("v", 0) or 0),
                }
            )
        out.sort(key=lambda row: int(row["t"]))
        return out

    def _merge_rows(self, a: list[dict[str, Any]], b: list[dict[str, Any]]) -> list[dict[str, Any]]:
        merged: dict[int, dict[str, Any]] = {}
        for row in a:
            merged[int(row["t"])] = row
        for row in b:
            merged[int(row["t"])] = row
        out = list(merged.values())
        out.sort(key=lambda row: int(row["t"]))
        return out

    def _get_hot(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        bucket = self._hot_rows.get((symbol, interval))
        if not bucket:
            return []
        expiry, rows_by_ts = bucket
        if time.time() >= expiry:
            self._hot_rows.pop((symbol, interval), None)
            return []
        out = [row for ts, row in rows_by_ts.items() if int(start_ms) <= ts <= int(end_ms)]
        out.sort(key=lambda row: int(row["t"]))
        return out

    def _set_hot(self, symbol: str, interval: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        bucket = {int(r["t"]): r for r in rows}
        self._hot_rows[(symbol, interval)] = (time.time() + self.hot_ttl_seconds, bucket)

    def _get_range_sync(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        min_fetched_at = time.time() - self.warm_ttl_seconds
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT ts, open, high, low, close, volume
                FROM ohlcv_cache
                WHERE symbol = ? AND interval = ? AND ts BETWEEN ? AND ? AND fetched_at >= ?
                ORDER BY ts ASC
                """,
                (symbol, interval, int(start_ms), int(end_ms), float(min_fetched_at)),
            ).fetchall()
        return [
            {"t": int(ts), "o": float(o), "h": float(h), "l": float(l), "c": float(c), "v": float(v)}
            for ts, o, h, l, c, v in rows
        ]

    def _put_bars_sync(self, symbol: str, interval: str, rows: list[dict[str, Any]]) -> None:
        sql_rows = [
            (
                symbol,
                interval,
                int(r["t"]),
                float(r["o"]),
                float(r["h"]),
                float(r["l"]),
                float(r["c"]),
                float(r.get("v", 0) or 0),
                float(time.time()),
            )
            for r in rows
        ]
        if not sql_rows:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT OR REPLACE INTO ohlcv_cache(symbol, interval, ts, open, high, low, close, volume, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                sql_rows,
            )
            conn.commit()

    def _put_bars_mem(self, symbol: str, interval: str, rows: list[dict[str, Any]]) -> None:
        bucket = self._mem_rows.setdefault((symbol, interval), {})
        for r in rows:
            ts = int(r["t"])
            bucket[ts] = r

    def _get_range_mem(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        bucket = self._mem_rows.get((symbol, interval), {})
        out = [row for ts, row in bucket.items() if int(start_ms) <= ts <= int(end_ms)]
        out.sort(key=lambda row: int(row["t"]))
        return out

    def _cold_path_for_year(self, symbol: str, interval: str, year: int) -> Path:
        return self.cold_root / symbol.upper() / interval / f"{year}.parquet"

    def _read_cold_range_sync(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        start_year = time.gmtime(start_ms / 1000).tm_year
        end_year = time.gmtime(end_ms / 1000).tm_year
        rows: list[dict[str, Any]] = []
        for year in range(start_year, end_year + 1):
            path = self._cold_path_for_year(symbol, interval, year)
            if not path.exists():
                continue
            try:
                df = pd.read_parquet(path)
            except Exception:
                continue
            if df.empty:
                continue
            subset = df[(df["t"] >= int(start_ms)) & (df["t"] <= int(end_ms))]
            for _, row in subset.iterrows():
                rows.append(
                    {
                        "t": int(row["t"]),
                        "o": float(row["o"]),
                        "h": float(row["h"]),
                        "l": float(row["l"]),
                        "c": float(row["c"]),
                        "v": float(row.get("v", 0) or 0),
                    }
                )
        rows.sort(key=lambda r: int(r["t"]))
        return rows

    def _promote_cold_sync(self, symbol: str, interval: str, rows: list[dict[str, Any]]) -> None:
        cutoff_ms = int((time.time() - (30 * 24 * 60 * 60)) * 1000)
        old_rows = [r for r in rows if int(r["t"]) < cutoff_ms]
        if not old_rows:
            return
        groups: dict[int, list[dict[str, Any]]] = {}
        for row in old_rows:
            year = time.gmtime(int(row["t"]) / 1000).tm_year
            groups.setdefault(year, []).append(row)
        for year, group in groups.items():
            path = self._cold_path_for_year(symbol, interval, year)
            path.parent.mkdir(parents=True, exist_ok=True)
            incoming = pd.DataFrame(group)
            if path.exists():
                try:
                    existing = pd.read_parquet(path)
                    merged = pd.concat([existing, incoming], ignore_index=True)
                except Exception:
                    merged = incoming
            else:
                merged = incoming
            merged = merged.drop_duplicates(subset=["t"], keep="last").sort_values("t")
            merged.to_parquet(path, index=False)


_ohlcv_cache = OHLCVCache()


def get_ohlcv_cache() -> OHLCVCache:
    return _ohlcv_cache
