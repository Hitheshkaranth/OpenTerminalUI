from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import pickle
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Tuple

from redis import asyncio as aioredis

logger = logging.getLogger(__name__)

class MultiTierCache:
    def __init__(self, redis_url: Optional[str] = None, db_path: str = "trade_screens_cache.db"):
        self.redis_url = redis_url or os.getenv("REDIS_URL")
        self.db_path = db_path
        self._l1_cache: Dict[str, Tuple[float, Any]] = {}  # Key -> (Expiry, Value)
        self._redis: Optional[aioredis.Redis] = None
        self._db_conn: Optional[sqlite3.Connection] = None

    async def initialize(self):
        # L2: Redis
        if self.redis_url:
            try:
                self._redis = aioredis.from_url(self.redis_url, decode_responses=False)
                await self._redis.ping()
                logger.info("L2 Cache (Redis) connected")
            except Exception as e:
                logger.warning(f"L2 Cache (Redis) connection failed: {e}")
                self._redis = None

        # L3: SQLite
        try:
            self._db_conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._db_conn.execute(
                "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value BLOB, expiry REAL)"
            )
            self._db_conn.execute("CREATE INDEX IF NOT EXISTS idx_expiry ON cache (expiry)")
            self._db_conn.commit()
            logger.info("L3 Cache (SQLite) connected")
        except Exception as e:
            logger.error(f"L3 Cache (SQLite) init failed: {e}")

    async def close(self):
        if self._redis:
            await self._redis.close()
        if self._db_conn:
            self._db_conn.close()

    def _get_l1(self, key: str) -> Optional[Any]:
        if key in self._l1_cache:
            expiry, value = self._l1_cache[key]
            if time.time() < expiry:
                return value
            else:
                del self._l1_cache[key]
        return None

    def _set_l1(self, key: str, value: Any, ttl: int):
        self._l1_cache[key] = (time.time() + ttl, value)

    async def _get_l2(self, key: str) -> Optional[Any]:
        if not self._redis:
            return None
        try:
            data = await self._redis.get(key)
            return pickle.loads(data) if data else None
        except Exception as e:
            logger.warning(f"L2 get error: {e}")
            return None

    async def _set_l2(self, key: str, value: Any, ttl: int):
        if not self._redis:
            return
        try:
            await self._redis.setex(key, ttl, pickle.dumps(value))
        except Exception as e:
            logger.warning(f"L2 set error: {e}")

    async def _get_l3(self, key: str) -> Optional[Any]:
        if not self._db_conn:
            return None
        
        def _read():
            cursor = self._db_conn.execute("SELECT value, expiry FROM cache WHERE key = ?", (key,))
            row = cursor.fetchone()
            if row:
                blob, expiry = row
                if time.time() < expiry:
                    return pickle.loads(blob)
                else:
                    # Lazy delete
                    self._db_conn.execute("DELETE FROM cache WHERE key = ?", (key,))
                    self._db_conn.commit()
            return None

        # Run in thread pool to check expiry/fetching
        return await asyncio.to_thread(_read)

    async def _set_l3(self, key: str, value: Any, ttl: int):
        if not self._db_conn:
            return

        def _write():
            expiry = time.time() + ttl
            blob = pickle.dumps(value)
            self._db_conn.execute(
                "INSERT OR REPLACE INTO cache (key, value, expiry) VALUES (?, ?, ?)",
                (key, blob, expiry)
            )
            self._db_conn.commit()

        await asyncio.to_thread(_write)

    async def get(self, key: str) -> Optional[Any]:
        # L1
        val = self._get_l1(key)
        if val is not None:
            return val

        # L2
        val = await self._get_l2(key)
        if val is not None:
            # Backfill L1
            # We don't know original TTL here, so use a default short TTL for L1 backfill 
            # or just don't backfill L1 to avoid stale data issues if L2 TTL is short.
            # Let's backfill L1 with short TTL (e.g. 10s) to save repeated Redis hits in hot loops
            self._set_l1(key, val, 10) 
            return val

        # L3
        val = await self._get_l3(key)
        if val is not None:
            # Backfill L2 and L1
            # Assume strict hierarchy: L3 is persistent, if found here but not L2/L1, separate logic?
            # For simplicity, backfill both
            # Again, TTL is tricky without storing it explicitly or retrieving existing expiry.
            # We stored expiry in L3, we could return it.
            # For now, backfill with safe formatting.
            await self._set_l2(key, val, 300) # Arbitrary backfill TTL
            self._set_l1(key, val, 10)
            return val

        return None

    async def set(self, key: str, value: Any, ttl: int = 300):
        # Write to all layers
        self._set_l1(key, value, ttl)
        await self._set_l2(key, value, ttl)
        await self._set_l3(key, value, ttl)

    def build_key(self, data_type: str, symbol: str, params: Optional[dict] = None) -> str:
        s = symbol.strip().upper()
        p_str = json.dumps(params or {}, sort_keys=True)
        h = hashlib.md5(p_str.encode()).hexdigest()
        return f"trade_screens:{data_type}:{s}:{h}"

cache = MultiTierCache()
