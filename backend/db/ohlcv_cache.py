from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path
from typing import Any

from backend.config.settings import get_settings

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
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
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


class OHLCVCache:
    def __init__(self) -> None:
        settings = get_settings()
        self.sqlite_path = _sqlite_file_from_url(settings.sqlite_url)
        self._init_lock = asyncio.Lock()
        self._ready = False

    async def initialize(self) -> None:
        async with self._init_lock:
            if self._ready:
                return
            self.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(self._initialize_sync)
            self._ready = True

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self.sqlite_path), check_same_thread=False)

    def _initialize_sync(self) -> None:
        with self._connect() as conn:
            conn.executescript(CREATE_TABLE)
            conn.commit()

    async def get_range(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        await self.initialize()
        return await asyncio.to_thread(self._get_range_sync, symbol.upper(), interval, start_ms, end_ms)

    def _get_range_sync(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT ts, open, high, low, close, volume
                FROM ohlcv_cache
                WHERE symbol = ? AND interval = ? AND ts BETWEEN ? AND ?
                ORDER BY ts ASC
                """,
                (symbol, interval, int(start_ms), int(end_ms)),
            ).fetchall()
        return [
            {"t": int(ts), "o": float(o), "h": float(h), "l": float(l), "c": float(c), "v": float(v)}
            for ts, o, h, l, c, v in rows
        ]

    async def put_bars(self, symbol: str, interval: str, bars: list[dict[str, Any]]) -> None:
        if not bars:
            return
        await self.initialize()
        await asyncio.to_thread(self._put_bars_sync, symbol.upper(), interval, bars)

    def _put_bars_sync(self, symbol: str, interval: str, bars: list[dict[str, Any]]) -> None:
        rows = [
            (
                symbol,
                interval,
                int(b["t"]),
                float(b["o"]),
                float(b["h"]),
                float(b["l"]),
                float(b["c"]),
                float(b.get("v", 0) or 0),
            )
            for b in bars
            if all(k in b for k in ("t", "o", "h", "l", "c"))
        ]
        if not rows:
            return
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT OR REPLACE INTO ohlcv_cache(symbol, interval, ts, open, high, low, close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()


_ohlcv_cache = OHLCVCache()


def get_ohlcv_cache() -> OHLCVCache:
    return _ohlcv_cache
