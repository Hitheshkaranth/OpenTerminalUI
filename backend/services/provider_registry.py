from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.adapters.provider_contracts import CryptoDataProvider, MarketDataProvider
from backend.core.failover import FailoverSlot, call_with_failover


@dataclass
class ProviderRegistry:
    failure_threshold: int = 3
    cooldown_seconds: int = 30
    _market: list[FailoverSlot] = field(default_factory=list)
    _crypto: list[FailoverSlot] = field(default_factory=list)

    def register_market(self, provider: MarketDataProvider, priority: int = 100) -> None:
        self._market.append(FailoverSlot(name=provider.name, target=provider, priority=priority))
        self._market.sort(key=lambda s: s.priority)

    def register_crypto(self, provider: CryptoDataProvider, priority: int = 100) -> None:
        self._crypto.append(FailoverSlot(name=provider.name, target=provider, priority=priority))
        self._crypto.sort(key=lambda s: s.priority)

    async def call_market(self, method: str, *args: Any, **kwargs: Any) -> Any:
        return await call_with_failover(
            self._market,
            method,
            *args,
            failure_threshold=self.failure_threshold,
            cooldown_seconds=self.cooldown_seconds,
            **kwargs,
        )

    async def call_crypto(self, method: str, *args: Any, **kwargs: Any) -> Any:
        return await call_with_failover(
            self._crypto,
            method,
            *args,
            failure_threshold=self.failure_threshold,
            cooldown_seconds=self.cooldown_seconds,
            **kwargs,
        )

    def health_snapshot(self) -> dict[str, list[dict[str, Any]]]:
        return {
            "market": [s.snapshot() for s in self._market],
            "crypto": [s.snapshot() for s in self._crypto],
        }
