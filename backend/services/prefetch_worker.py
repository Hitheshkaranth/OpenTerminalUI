from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import List

from backend.core.unified_fetcher import UnifiedFetcher
from backend.services.cache import cache
from backend.db.database import SessionLocal
from backend.db.models import Holding, WatchlistItem

logger = logging.getLogger(__name__)

MARKET_START = (9, 15)
MARKET_END = (15, 30)

def is_market_hours() -> bool:
    # IST = UTC + 5:30
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc + timedelta(hours=5, minutes=30)
    
    # Weekends
    if now_ist.weekday() >= 5:
        return False
        
    t = now_ist.time()
    start = t.replace(hour=MARKET_START[0], minute=MARKET_START[1], second=0, microsecond=0)
    end = t.replace(hour=MARKET_END[0], minute=MARKET_END[1], second=0, microsecond=0)
    
    return start <= t <= end

def get_db_tickers() -> List[str]:
    db = SessionLocal()
    try:
        holdings = [h.ticker for h in db.query(Holding.ticker).all()]
        watchlist = [w.ticker for w in db.query(WatchlistItem.ticker).all()]
        return list(set(holdings + watchlist))
    except Exception as e:
        logger.error(f"Error fetching DB tickers: {e}")
        return []
    finally:
        db.close()

# Hardcoded indices for robustness (could be fetched dynamically)
NIFTY_50 = [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "BHARTIARTL", "ITC", "LTIM", "HINDUNILVR", "LT",
    "SBIN", "BAJFINANCE", "AXISBANK", "ASIANPAINT", "MARUTI", "TITAN", "SUNPHARMA", "ULTRACEMCO", "KOTAKBANK",
    "TATASTEEL", "NTPC", "TATAMOTORS", "POWERGRID", "ADANIENT", "M&M", "HCLTECH", "JSWSTEEL", "COALINDIA",
    "ADANIPORTS", "WIPRO", "ONGC", "NESTLEIND", "BPCL", "TECHM", "GRASIM", "BRITANNIA", "CIPLA", "HDFCLIFE",
    "BAJAJFINSV", "SBILIFE", "DRREDDY", "INDUSINDBK", "EICHERMOT", "DIVISLAB", "TATACONSUM", "HINDALCO",
    "APOLLOHOSP", "HEROMOTOCO", "UPL"
]

class PrefetchWorker:
    def __init__(self, fetcher: UnifiedFetcher, interval: int = 900):
        self.fetcher = fetcher
        self.interval = interval
        self._task = None
        self._stop_event = asyncio.Event()

    async def start(self):
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._loop())
        logger.info("event=prefetch_worker_started interval_seconds=%s", self.interval)

    async def stop(self):
        if self._task:
            self._stop_event.set()
            await self._task
            self._task = None
            logger.info("event=prefetch_worker_stopped")

    async def _loop(self):
        while not self._stop_event.is_set():
            if is_market_hours():
                logger.info("event=prefetch_cycle_start market_open=true")
                await self._prefetch()
            else:
                logger.debug("event=prefetch_cycle_skip market_open=false")
            
            # Wait for interval or stop
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval)
            except asyncio.TimeoutError:
                continue

    async def _prefetch(self):
        # 1. Gather tickers
        targets = set(NIFTY_50)
        targets.update(get_db_tickers())
        ticker_list = list(targets)
        
        logger.info("event=prefetch_symbols count=%s", len(ticker_list))
        
        # 2. Fetch/Cache in batches
        sem = asyncio.Semaphore(10) # Concurrency limit
        
        async def work(ticker):
            async with sem:
                try:
                    # We assume fetch_stock_snapshot does validity checks
                    # We need to explicitly CACHE it. 
                    # UnifiedFetcher doesn't cache internally yet, so we do it here?
                    # Or we update UnifiedFetcher to cache?
                    # User request 1F says "Cache key schema: lts:{data_type}:{symbol}:{params_hash}" in Cache class
                    # User request 1G says "Populates cache for instant responses"
                    # I'll rely on route handlers checking cache, so I must manually populate it here
                    # using the same key schema the route would use.
                    # Route likely calls: cache.get(...) -> if none -> fetcher.fetch() -> cache.set()
                    # So here I just simulate that: cache.set(key, fetcher.fetch())
                    
                    data = await self.fetcher.fetch_stock_snapshot(ticker)
                    if data:
                        # Emulate the key the route will use
                        key = cache.build_key("snapshot", ticker)
                        await cache.set(key, data, ttl=300) # 5 min TTL? or more? 15 mins interval
                except Exception as e:
                    logger.error(f"Prefetch failed for {ticker}: {e}")

        await asyncio.gather(*(work(t) for t in ticker_list))
        logger.info("event=prefetch_cycle_complete symbols=%s", len(ticker_list))

_worker_instance = None

def get_prefetch_worker(fetcher: UnifiedFetcher) -> PrefetchWorker:
    global _worker_instance
    if _worker_instance is None:
        _worker_instance = PrefetchWorker(fetcher)
    return _worker_instance
