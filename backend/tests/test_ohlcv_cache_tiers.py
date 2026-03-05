from __future__ import annotations

from pathlib import Path

import pytest

from backend.db.ohlcv_cache import OHLCVCache


def _bars(start_ms: int, count: int, step_ms: int = 60_000) -> list[dict[str, float | int]]:
    out: list[dict[str, float | int]] = []
    px = 100.0
    for i in range(count):
        ts = start_ms + (i * step_ms)
        out.append({"t": ts, "o": px, "h": px + 1, "l": px - 1, "c": px + 0.5, "v": 1000 + i})
        px += 0.2
    return out


@pytest.mark.asyncio
async def test_tiered_cache_hot_warm_waterfall(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "cache.db"
    cold_root = tmp_path / "bars"
    cache = OHLCVCache(sqlite_path=sqlite_path, cold_root=cold_root, hot_ttl_seconds=60, warm_ttl_seconds=3600)

    bars = _bars(1_700_000_000_000, 5)
    await cache.put_bars("AAPL", "1m", bars)

    result = await cache.get_range_with_gaps("AAPL", "1m", bars[0]["t"], bars[-1]["t"])
    assert result.complete is True
    assert result.tier in {"hot", "warm"}
    assert len(result.rows) == 5


@pytest.mark.asyncio
async def test_tiered_cache_cold_promotion_and_read(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    sqlite_path = tmp_path / "cache.db"
    cold_root = tmp_path / "bars"
    cache = OHLCVCache(sqlite_path=sqlite_path, cold_root=cold_root, hot_ttl_seconds=1, warm_ttl_seconds=3600)

    # Force data to be older than 30 days so cold promotion path is hit.
    now_s = 1_800_000_000
    monkeypatch.setattr("backend.db.ohlcv_cache.time.time", lambda: float(now_s))
    old_ms = (now_s - 31 * 24 * 60 * 60) * 1000
    bars = _bars(old_ms, 4)
    await cache.put_bars("MSFT", "1m", bars)

    year = __import__("time").gmtime(int(bars[0]["t"]) / 1000).tm_year
    parquet_path = cold_root / "MSFT" / "1m" / f"{year}.parquet"
    assert parquet_path.exists()

    # Simulate warm miss by expiring warm ttl aggressively and reading through cold tier.
    cache.warm_ttl_seconds = 1
    monkeypatch.setattr("backend.db.ohlcv_cache.time.time", lambda: float(now_s + 5))
    result = await cache.get_range_with_gaps("MSFT", "1m", bars[0]["t"], bars[-1]["t"])
    assert len(result.rows) == 4
    assert result.complete is True


@pytest.mark.asyncio
async def test_tiered_cache_reports_missing_ranges(tmp_path: Path) -> None:
    cache = OHLCVCache(sqlite_path=tmp_path / "cache.db", cold_root=tmp_path / "bars", hot_ttl_seconds=60, warm_ttl_seconds=3600)
    start = 1_700_100_000_000
    bars = _bars(start, 5)
    # Drop middle bar to create deterministic single gap.
    sparse = [bars[0], bars[1], bars[3], bars[4]]
    await cache.put_bars("NVDA", "1m", sparse)

    result = await cache.get_range_with_gaps("NVDA", "1m", bars[0]["t"], bars[-1]["t"])
    assert result.complete is False
    assert len(result.missing_ranges) == 1
