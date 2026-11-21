from __future__ import annotations

import asyncio
import hmac
import hashlib
import json
import logging
import os
import pickle
import sqlite3
import threading
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable, Optional, Tuple

from redis import asyncio as aioredis

from backend.config.security import get_cache_signing_key

logger = logging.getLogger(__name__)

# Redis calls must fail fast: a hung Redis would otherwise stall every request.
_REDIS_SOCKET_TIMEOUT_SECONDS = 1.0
# While in fallback mode, re-probe Redis at most this often and recover when it answers.
_REDIS_REPROBE_INTERVAL_SECONDS = 30.0
# Expired L3 (SQLite) rows are purged at most this often (triggered from set()).
_L3_PURGE_INTERVAL_SECONDS = 600.0


def _l1_max_entries() -> int:
    try:
        return max(1, int(os.getenv("CACHE_L1_MAX_ENTRIES", "5000")))
    except ValueError:
        return 5000


class MultiTierCache:
    def __init__(self, redis_url: Optional[str] = None, db_path: str = "trade_screens_cache.db"):
        self.redis_url = redis_url or os.getenv("REDIS_URL")
        self.db_path = db_path
        # Bounded LRU: most recently used at the end, evicted from the front.
        self._l1_cache: "OrderedDict[str, Tuple[float, Any]]" = OrderedDict()
        self._l1_max_entries = _l1_max_entries()
        self._redis: Optional[aioredis.Redis] = None
        self._db_conn: Optional[sqlite3.Connection] = None
        self._db_lock = threading.Lock()
        self._redis_fallback_mode: bool = False
        self._last_redis_probe: float = 0.0
        self._redis_probe_in_progress: bool = False
        self._last_l3_purge: float = time.time()
        # Single-flight: key -> in-flight fetch task (see get_or_fetch).
        self._inflight: dict[str, asyncio.Task] = {}
        key = get_cache_signing_key()
        self._signing_key = key.encode("utf-8")

    def _new_redis_client(self) -> aioredis.Redis:
        return aioredis.from_url(
            self.redis_url,
            decode_responses=False,
            socket_timeout=_REDIS_SOCKET_TIMEOUT_SECONDS,
            socket_connect_timeout=_REDIS_SOCKET_TIMEOUT_SECONDS,
        )

    async def initialize(self):
        if self.redis_url and self._redis is None:
            try:
                self._redis = self._new_redis_client()
                await self._redis.ping()
                self._redis_fallback_mode = False
                logger.info("L2 Cache (Redis) connected")
            except Exception as e:
                logger.warning("L2 Cache (Redis) connection failed: %s", e)
                await self._safe_close_redis(self._redis)
                self._redis = None
                # Configured but unreachable: run degraded and re-probe periodically.
                self._redis_fallback_mode = True
                self._last_redis_probe = time.time()

        try:
            self._db_conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=15)
            self._db_conn.execute("PRAGMA journal_mode=WAL;")
            self._db_conn.execute("PRAGMA synchronous=NORMAL;")
            self._db_conn.execute("PRAGMA busy_timeout=5000;")
            self._db_conn.execute(
                "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value BLOB, expiry REAL)"
            )
            self._db_conn.execute("CREATE INDEX IF NOT EXISTS idx_expiry ON cache (expiry)")
            self._db_conn.commit()
            logger.info("L3 Cache (SQLite) connected")
        except Exception as e:
            logger.error("L3 Cache (SQLite) init failed: %s", e)

    def enable_in_memory_fallback(self) -> None:
        """Mark the cache as using in-memory fallback due to Redis unavailability."""
        if self._redis_fallback_mode:
            return
        self._redis_fallback_mode = True
        if self._redis:
            try:
                asyncio.create_task(self._redis.close())
            except Exception:
                pass
            self._redis = None
        self._last_redis_probe = time.time()
        logger.warning(
            "Cache entered in-memory fallback mode (Redis unavailable); "
            "using L1 (memory) + L3 (SQLite) only. Re-probing every %ss.",
            int(_REDIS_REPROBE_INTERVAL_SECONDS),
        )

    @staticmethod
    async def _safe_close_redis(client: Optional[aioredis.Redis]) -> None:
        if client is None:
            return
        try:
            await client.close()
        except Exception:
            pass

    async def _maybe_recover_redis(self) -> None:
        """In fallback mode, ping Redis at most every 30s and leave fallback when it answers."""
        if not self._redis_fallback_mode or not self.redis_url or self._redis_probe_in_progress:
            return
        now = time.time()
        if now - self._last_redis_probe < _REDIS_REPROBE_INTERVAL_SECONDS:
            return
        self._redis_probe_in_progress = True
        self._last_redis_probe = now
        client: Optional[aioredis.Redis] = None
        try:
            client = self._new_redis_client()
            await client.ping()
        except Exception as e:
            logger.debug("Redis re-probe failed: %s", e)
            await self._safe_close_redis(client)
            return
        finally:
            self._redis_probe_in_progress = False
        self._redis = client
        self._redis_fallback_mode = False
        logger.info("L2 Cache (Redis) recovered; leaving in-memory fallback mode")

    @property
    def is_redis_available(self) -> bool:
        """Return True when Redis is configured, connected, and not in fallback mode."""
        return self._redis is not None and not self._redis_fallback_mode

    async def close(self):
        if self._redis:
            await self._redis.close()
            self._redis = None
        if self._db_conn:
            self._db_conn.close()
            self._db_conn = None

    async def health(self) -> dict[str, Any]:
        """Report availability of each cache tier (used by /healthz)."""
        l2 = "disabled"
        if self._redis_fallback_mode:
            l2 = "fallback_mode"
        elif self._redis is not None:
            try:
                await self._redis.ping()
                l2 = "ok"
            except Exception:
                l2 = "error"
        return {
            "l1_memory": {"status": "ok", "entries": len(self._l1_cache)},
            "l2_redis": l2,
            "l3_sqlite": "ok" if self._db_conn is not None else "unavailable",
        }

    def _get_l1(self, key: str) -> Optional[Any]:
        entry = self._l1_cache.get(key)
        if entry is not None:
            expiry, value = entry
            if time.time() < expiry:
                try:
                    self._l1_cache.move_to_end(key)
                except KeyError:
                    pass
                return value
            self._l1_cache.pop(key, None)
        return None

    def _set_l1(self, key: str, value: Any, ttl: int):
        self._l1_cache[key] = (time.time() + ttl, value)
        self._l1_cache.move_to_end(key)
        while len(self._l1_cache) > self._l1_max_entries:
            self._l1_cache.popitem(last=False)

    async def _get_l2(self, key: str) -> Optional[Any]:
        if self._redis_fallback_mode:
            await self._maybe_recover_redis()
        if self._redis_fallback_mode:
            return None
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
            if not self._redis_fallback_mode:
                self.enable_in_memory_fallback()
            return None

    async def _set_l2(self, key: str, value: Any, ttl: int):
        if self._redis_fallback_mode:
            await self._maybe_recover_redis()
        if self._redis_fallback_mode:
            return
        if not self._redis:
            return
        try:
            await self._redis.setex(key, ttl, self._encode_blob(value))
        except Exception as e:
            logger.warning("L2 set error: %s", e)
            if not self._redis_fallback_mode:
                self.enable_in_memory_fallback()

    def _ensure_db(self):
        if self._db_conn is not None:
            return
        try:
            self._db_conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=15)
            self._db_conn.execute("PRAGMA journal_mode=WAL;")
            self._db_conn.execute("PRAGMA synchronous=NORMAL;")
            self._db_conn.execute("PRAGMA busy_timeout=5000;")
            self._db_conn.execute(
                "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value BLOB, expiry REAL)"
            )
            self._db_conn.commit()
        except Exception as e:
            logger.warning("L3 reconnect failed: %s", e)
            self._db_conn = None

    async def _get_l3(self, key: str) -> Optional[Any]:
        self._ensure_db()
        if not self._db_conn:
            return None

        def _read():
            with self._db_lock:
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
        self._ensure_db()
        if not self._db_conn:
            return

        def _write():
            expiry = time.time() + ttl
            blob = self._encode_blob(value)
            with self._db_lock:
                self._db_conn.execute(
                    "INSERT OR REPLACE INTO cache (key, value, expiry) VALUES (?, ?, ?)",
                    (key, blob, expiry),
                )
                self._db_conn.commit()

        await asyncio.to_thread(_write)

    async def _maybe_purge_l3(self) -> None:
        """Delete expired L3 rows, at most once per _L3_PURGE_INTERVAL_SECONDS."""
        now = time.time()
        if now - self._last_l3_purge < _L3_PURGE_INTERVAL_SECONDS:
            return
        self._last_l3_purge = now
        self._ensure_db()
        if not self._db_conn:
            return

        def _purge() -> None:
            with self._db_lock:
                self._db_conn.execute("DELETE FROM cache WHERE expiry < ?", (time.time(),))
                self._db_conn.commit()

        try:
            await asyncio.to_thread(_purge)
        except Exception as e:
            logger.warning("L3 purge failed: %s", e)

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
        # Redis is the shared tier when healthy; the SQLite tier is only the fallback
        # store (a failed L2 write above flips us into fallback, so the value still lands).
        if not self.is_redis_available:
            await self._set_l3(key, value, ttl)
        await self._maybe_purge_l3()

    async def get_or_fetch(
        self,
        key: str,
        ttl: int,
        fetcher: Callable[[], Awaitable[Any]],
        *,
        force_refresh: bool = False,
        cache_if: Optional[Callable[[Any], bool]] = None,
    ) -> Any:
        """Return the cached value or fetch it, coalescing concurrent misses (single-flight).

        Concurrent callers for the same key share ONE in-flight ``fetcher()`` call. The
        fetch runs in its own task, so a cancelled caller does not cancel it for the
        others. The result is cached when ``cache_if(result)`` is true (default: not
        None). ``force_refresh`` skips the initial cache read but still coalesces.
        Exceptions from ``fetcher`` propagate to every waiter and are not cached.
        """
        if not force_refresh:
            cached = await self.get(key)
            if cached is not None:
                return cached

        loop = asyncio.get_running_loop()
        task = self._inflight.get(key)
        if task is None or task.done() or task.get_loop() is not loop:
            should_cache = cache_if or (lambda value: value is not None)
            holder: list[asyncio.Task] = []

            async def _run() -> Any:
                try:
                    value = await fetcher()
                    if should_cache(value):
                        await self.set(key, value, ttl=ttl)
                    return value
                finally:
                    if holder and self._inflight.get(key) is holder[0]:
                        self._inflight.pop(key, None)

            task = loop.create_task(_run())
            holder.append(task)
            self._inflight[key] = task
        return await asyncio.shield(task)

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
        """Decode and verify a cached blob.

        SECURITY: HMAC signature is verified BEFORE any unpickling to prevent
        deserialization of tampered data.  pickle is inherently unsafe for
        untrusted data; consider migrating to msgpack or JSON for future
        cache tiers.
        """
        import warnings

        if not isinstance(blob, (bytes, bytearray)):
            return None
        if not blob.startswith(b"v1:") or len(blob) < 3 + 32:
            return None
        signature = blob[3:35]
        payload = blob[35:]
        # SECURITY: Verify HMAC *before* unpickling so that any tampered
        # payload is rejected prior to pickle.loads() being called.
        expected = hmac.new(self._signing_key, payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            return None
        try:
            return pickle.loads(payload)  # security: HMAC-verified; consider msgpack migration
        except Exception:
            return None


# Path is overridable so the test suite can use a throwaway file: tests used to write fake data into
# the same on-disk cache the app serves from (e.g. synthetic theme indices shown live for 15 min).
cache = MultiTierCache(db_path=os.getenv("OPENTERMINALUI_CACHE_DB", "trade_screens_cache.db"))
