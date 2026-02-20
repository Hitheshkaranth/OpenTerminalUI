"""Rate-limit-aware scheduler with exponential backoff and jitter."""
from __future__ import annotations

import logging
import random
import time

logger = logging.getLogger(__name__)


class RateLimitScheduler:
    """Tracks a per-provider backoff state.

    Usage:
        scheduler = RateLimitScheduler("polygon", base_interval=5.0)
        # Before each request:
        await asyncio.sleep(scheduler.current_interval)
        try:
            result = await provider.fetch(...)
            scheduler.on_success()
        except RateLimitError:
            scheduler.on_rate_limit()
        except Exception:
            scheduler.on_error()
    """

    def __init__(
        self,
        provider_name: str,
        base_interval: float = 5.0,
        max_interval: float = 300.0,
        jitter_factor: float = 0.3,
    ):
        self.provider = provider_name
        self.base = base_interval
        self.max = max_interval
        self.jitter_factor = jitter_factor
        self._current = base_interval
        self._consecutive_failures = 0
        self._last_call: float = 0.0

    @property
    def current_interval(self) -> float:
        return self._current

    def on_success(self) -> None:
        self._consecutive_failures = 0
        self._current = self.base
        self._last_call = time.monotonic()

    def on_rate_limit(self) -> None:
        self._consecutive_failures += 1
        backoff = min(
            self.base * (2**self._consecutive_failures),
            self.max,
        )
        jitter = random.uniform(0, backoff * self.jitter_factor)
        self._current = backoff + jitter
        logger.warning(
            "Rate limit hit for %s — backing off %.1fs (attempt %d)",
            self.provider,
            self._current,
            self._consecutive_failures,
        )

    def on_error(self) -> None:
        self._consecutive_failures += 1
        self._current = min(self._current * 1.5, self.max)
        logger.warning(
            "Error for %s — interval now %.1fs", self.provider, self._current
        )

    def reset(self) -> None:
        self._consecutive_failures = 0
        self._current = self.base
