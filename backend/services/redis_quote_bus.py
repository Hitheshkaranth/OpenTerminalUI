from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Callable, Dict, List, Optional, Set

from redis import asyncio as aioredis
from backend.config.settings import get_settings

logger = logging.getLogger(__name__)

class RedisQuoteBus:
    def __init__(self):
        self.settings = get_settings()
        self._redis: Optional[aioredis.Redis] = None
        self._pubsub: Optional[aioredis.client.PubSub] = None
        self._local_listeners: Set[Callable[[str, Dict[str, Any]], Any]] = set()
        self._subscribed_channels: Set[str] = set()
        self._is_connected = False
        self._listen_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()

    async def connect(self) -> bool:
        if self._is_connected:
            return True

        async with self._lock:
            try:
                self._redis = aioredis.from_url(
                    self.settings.redis_url,
                    max_connections=self.settings.redis_max_connections,
                    decode_responses=True
                )
                await self._redis.ping()
                self._is_connected = True
                logger.info("Redis Quote Bus connected to %s", self.settings.redis_url)
                return True
            except Exception as e:
                logger.warning("Redis Quote Bus connection failed: %s. Falling back to in-memory.", e)
                self._is_connected = False
                self._redis = None
                return False

    async def disconnect(self):
        async with self._lock:
            if self._listen_task:
                self._listen_task.cancel()
                try:
                    await self._listen_task
                except asyncio.CancelledError:
                    pass
                self._listen_task = None

            if self._pubsub:
                await self._pubsub.close()
                self._pubsub = None

            if self._redis:
                await self._redis.close()
                self._redis = None

            self._is_connected = False

    def register_local_listener(self, callback: Callable[[str, Dict[str, Any]], Any]):
        self._local_listeners.add(callback)

    def unregister_local_listener(self, callback: Callable[[str, Dict[str, Any]], Any]):
        self._local_listeners.discard(callback)

    async def publish_tick(self, market: str, payload: Dict[str, Any]):
        """Publish a tick to Redis or local listeners if Redis is down."""
        # Standardize market name
        market = market.lower()
        channel = f"quotes:{market}"

        # Always emit to local listeners first (or should we?)
        # If we have multiple instances, instance A gets tick from provider,
        # publishes to Redis, instance A also listens to Redis and emits to its local clients.
        # This prevents double-emits if we don't handle it.
        # But if Redis is down, we MUST emit locally.

        if not self._is_connected:
            await self._emit_local(channel, payload)
            return

        try:
            await self._redis.publish(channel, json.dumps(payload))
        except Exception as e:
            logger.error("Redis publish failed: %s. Falling back to local emit.", e)
            await self._emit_local(channel, payload)

    async def publish_bar(self, market: str, timeframe: str, payload: Dict[str, Any]):
        """Publish a completed bar."""
        market = market.lower()
        channel = f"bars:{market}:{timeframe}"

        if not self._is_connected:
            await self._emit_local(channel, payload)
            return

        try:
            await self._redis.publish(channel, json.dumps(payload))
        except Exception as e:
            logger.error("Redis bar publish failed: %s", e)
            await self._emit_local(channel, payload)

    async def subscribe_market(self, market: str):
        market = market.lower()
        channel = f"quotes:{market}"
        await self._subscribe(channel)

    async def subscribe_bars(self, market: str, timeframe: str):
        market = market.lower()
        channel = f"bars:{market}:{timeframe}"
        await self._subscribe(channel)

    async def _subscribe(self, channel: str):
        if not self._is_connected:
            return

        async with self._lock:
            if channel in self._subscribed_channels:
                return

            if not self._pubsub:
                self._pubsub = self._redis.pubsub()
                self._listen_task = asyncio.create_task(self._listen_loop())

            await self._pubsub.subscribe(channel)
            self._subscribed_channels.add(channel)
            logger.info("Subscribed to Redis channel: %s", channel)

    async def _listen_loop(self):
        try:
            while self._is_connected and self._pubsub:
                message = await self._pubsub.get_message(timeout=1.0)
                if message:
                    if message["type"] != "message":
                        continue
                    channel = message["channel"]
                    try:
                        data = json.loads(message["data"])
                        await self._emit_local(channel, data)
                    except Exception:
                        logger.exception("Failed to process Redis message on %s", channel)
                await asyncio.sleep(0.01)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Redis Quote Bus listen loop crashed")
            self._is_connected = False

    async def _emit_local(self, channel: str, payload: Dict[str, Any]):
        for cb in list(self._local_listeners):
            try:
                res = cb(channel, payload)
                if asyncio.iscoroutine(res):
                    await res
            except Exception:
                logger.exception("Local listener callback failed")

    async def acquire_aggregator_lock(self, instance_id: str, ttl: int = 10) -> bool:
        """Try to acquire the aggregator lock using Redlock pattern (simple version)."""
        if not self._is_connected:
            # If no Redis, everyone is an aggregator? Or only one?
            # In single instance mode (no Redis), we should be aggregator.
            return True

        lock_key = "lock:candle_aggregator"
        try:
            # NX = Only set if not exists, EX = TTL in seconds
            return bool(await self._redis.set(lock_key, instance_id, ex=ttl, nx=True))
        except Exception:
            return True # Fallback to true to keep it working locally

    async def renew_aggregator_lock(self, instance_id: str, ttl: int = 10) -> bool:
        if not self._is_connected:
            return True

        lock_key = "lock:candle_aggregator"
        try:
            # Only renew if we still hold it
            val = await self._redis.get(lock_key)
            if val == instance_id:
                await self._redis.expire(lock_key, ttl)
                return True
            return False
        except Exception:
            return False

    @property
    def is_connected(self) -> bool:
        return self._is_connected

_quote_bus = RedisQuoteBus()

def get_quote_bus() -> RedisQuoteBus:
    return _quote_bus
