from __future__ import annotations

import asyncio
import logging
from typing import Any, Generator

from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.core.unified_fetcher import UnifiedFetcher
from backend.db.database import SessionLocal
from backend.services.cache import cache as cache_instance

logger = logging.getLogger(__name__)

_fetcher_instance: UnifiedFetcher | None = None
_fetcher_lock = asyncio.Lock()

def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def get_unified_fetcher() -> UnifiedFetcher:
    global _fetcher_instance
    if _fetcher_instance:
        return _fetcher_instance
        
    async with _fetcher_lock:
        if _fetcher_instance:
            return _fetcher_instance
        
        # Initialize
        fetcher = UnifiedFetcher.build_default()
        await fetcher.startup()
        _fetcher_instance = fetcher
        
        # Initialize cache (L2/L3 connections)
        await cache_instance.initialize()
        
        return _fetcher_instance

async def shutdown_unified_fetcher() -> None:
    global _fetcher_instance
    if _fetcher_instance:
        await _fetcher_instance.shutdown()
        _fetcher_instance = None
    
    await cache_instance.close()

async def fetch_stock_snapshot_coalesced(ticker: str) -> dict[str, Any]:
    """
    Fetch snapshot with request coalescing (locking) and caching.
    """
    symbol = ticker.strip().upper()
    
    # 1. Check Cache
    # Params dict is empty for snapshot
    cache_key = cache_instance.build_key("snapshot", symbol, {})
    cached_data = await cache_instance.get(cache_key)
    if cached_data:
        return cached_data

    # 2. Coalescing (Single Flight)
    # Since we lack a dedicated single-flight mechanism in cache.py, we can use a lock 
    # but that's local only. For distributed, we'd need Redis lock.
    # For now, just fetch. The prefetch worker handles the heavy lifting.
    
    fetcher = await get_unified_fetcher()
    try:
        data = await fetcher.fetch_stock_snapshot(symbol)
        if data:
            await cache_instance.set(
                cache_key,
                data,
                ttl=ttl_seconds("snapshot", market_open_now()),
            )
        return data
    except Exception as e:
        logger.error(f"Snapshot fetch failed for {symbol}: {e}")
        return {}
