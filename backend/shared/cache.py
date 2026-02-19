from __future__ import annotations

import asyncio
import hmac
import hashlib
import json
import logging
import os
import pickle
import sqlite3
import time
from typing import Any, Optional, Tuple

from redis import asyncio as aioredis

logger = logging.getLogger(__name__)


class MultiTierCache:
    def __init__(self, redis_url: Optional[str] = None, db_path: str = "trade_screens_cache.db"):
        self.redis_url = redis_url or os.getenv("REDIS_URL")
        self.db_path = db_path
        self._l1_cache: dict[str, Tuple[float, Any]] = {}
        self._redis: Optional[aioredis.Redis] = None
        self._db_conn: Optional[sqlite3.Connection] = None
        key = os.getenv("CACHE_SIGNING_KEY", "openterminalui-dev-cache-key")
        self._signing_key = key.encode("utf-8")

    async def initialize(self):
        if self.redis_url:
            try:
                self._redis = aioredis.from_url(self.redis_url, decode_responses=False)
                await self._redis.ping()
                logger.info("L2 Cache (Redis) connected")
            except Exception as e:
                logger.warning("L2 Cache (Redis) connection failed: %s", e)
                self._redis = None

        try:
            self._db_conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._db_conn.execute(
                "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value BLOB, expiry REAL)"
            )
            self._db_conn.execute("CREATE INDEX IF NOT EXISTS idx_expiry ON cache (expiry)")
            self._db_conn.commit()
            logger.info("L3 Cache (SQLite) connected")
        except Exception as e:
            logger.error("L3 Cache (SQLite) init failed: %s", e)

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
            del self._l1_cache[key]
        return None

    def _set_l1(self, key: str, value: Any, ttl: int):
        self._l1_cache[key] = (time.time() + ttl, value)

    async def _get_l2(self, key: str) -> Optional[Any]:
        if not self._redis:
            return None
        try:
            data = await self._redis.get(key)
            if not data:
                return None
            decoded = self._decode_blob(data)
            return decoded
        except Exception as e:
            logger.warning("L2 get error: %s", e)
            return None

    async def _set_l2(self, key: str, value: Any, ttl: int):
        if not self._redis:
            return
        try:
            await self._redis.setex(key, ttl, self._encode_blob(value))
        except Exception as e:
            logger.warning("L2 set error: %s", e)

    async def _get_l3(self, key: str) -> Optional[Any]:
        if not self._db_conn:
            return None

        def _read():
            cursor = self._db_conn.execute("SELECT value, expiry FROM cache WHERE key = ?", (key,))
            row = cursor.fetchone()
            if row:
                blob, expiry = row
                if time.time() < expiry:
                    return self._decode_blob(blob)
                self._db_conn.execute("DELETE FROM cache WHERE key = ?", (key,))
                self._db_conn.commit()
            return None

        return await asyncio.to_thread(_read)

    async def _set_l3(self, key: str, value: Any, ttl: int):
        if not self._db_conn:
            return

        def _write():
            expiry = time.time() + ttl
            blob = self._encode_blob(value)
            self._db_conn.execute(
                "INSERT OR REPLACE INTO cache (key, value, expiry) VALUES (?, ?, ?)",
                (key, blob, expiry),
            )
            self._db_conn.commit()

        await asyncio.to_thread(_write)

    async def get(self, key: str) -> Optional[Any]:
        val = self._get_l1(key)
        if val is not None:
            return val

        val = await self._get_l2(key)
        if val is not None:
            self._set_l1(key, val, 10)
            return val

        val = await self._get_l3(key)
        if val is not None:
            await self._set_l2(key, val, 300)
            self._set_l1(key, val, 10)
            return val

        return None

    async def set(self, key: str, value: Any, ttl: int = 300):
        self._set_l1(key, value, ttl)
        await self._set_l2(key, value, ttl)
        await self._set_l3(key, value, ttl)

    def build_key(self, data_type: str, symbol: str, params: Optional[dict] = None) -> str:
        s = symbol.strip().upper()
        p_str = json.dumps(params or {}, sort_keys=True)
        h = hashlib.md5(p_str.encode()).hexdigest()
        return f"openterminalui:{data_type}:{s}:{h}"

    def _encode_blob(self, value: Any) -> bytes:
        payload = pickle.dumps(value)
        signature = hmac.new(self._signing_key, payload, hashlib.sha256).digest()
        return b"v1:" + signature + payload

    def _decode_blob(self, blob: bytes) -> Any:
        if not isinstance(blob, (bytes, bytearray)):
            return None
        if not blob.startswith(b"v1:") or len(blob) < 3 + 32:
            return None
        signature = blob[3:35]
        payload = blob[35:]
        expected = hmac.new(self._signing_key, payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            return None
        try:
            return pickle.loads(payload)
        except Exception:
            return None


cache = MultiTierCache()
