from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.adapters.provider_contracts import CryptoDataProvider, MarketDataProvider


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class _ProviderSlot:
    name: str
    provider: Any
    priority: int
    failures: int = 0
    last_error: str | None = None
    last_success_at: datetime | None = None
    suspended_until: datetime | None = None

    def can_run(self) -> bool:
        if self.suspended_until is None:
            return True
        return _now_utc() >= self.suspended_until

    def mark_success(self) -> None:
        self.failures = 0
        self.last_error = None
        self.suspended_until = None
        self.last_success_at = _now_utc()

    def mark_failure(self, error: Exception, threshold: int, cooldown_seconds: int) -> None:
        self.failures += 1
        self.last_error = str(error)
        if self.failures >= threshold:
            self.suspended_until = _now_utc() + timedelta(seconds=max(1, cooldown_seconds))


@dataclass
class ProviderRegistry:
    failure_threshold: int = 3
    cooldown_seconds: int = 30
    _market: list[_ProviderSlot] = field(default_factory=list)
    _crypto: list[_ProviderSlot] = field(default_factory=list)

    def register_market(self, provider: MarketDataProvider, priority: int = 100) -> None:
        self._market.append(_ProviderSlot(name=provider.name, provider=provider, priority=priority))
        self._market.sort(key=lambda s: s.priority)

    def register_crypto(self, provider: CryptoDataProvider, priority: int = 100) -> None:
        self._crypto.append(_ProviderSlot(name=provider.name, provider=provider, priority=priority))
        self._crypto.sort(key=lambda s: s.priority)

    async def call_market(self, method: str, *args: Any, **kwargs: Any) -> Any:
        return await self._call_chain(self._market, method, *args, **kwargs)

    async def call_crypto(self, method: str, *args: Any, **kwargs: Any) -> Any:
        return await self._call_chain(self._crypto, method, *args, **kwargs)

    async def _call_chain(self, chain: list[_ProviderSlot], method: str, *args: Any, **kwargs: Any) -> Any:
        if not chain:
            raise RuntimeError("No providers registered")

        last_exc: Exception | None = None
        for slot in chain:
            if not slot.can_run():
                continue
            fn = getattr(slot.provider, method, None)
            if fn is None:
                continue
            try:
                result = await fn(*args, **kwargs)
                slot.mark_success()
                return result
            except Exception as exc:  # explicit fallback behavior
                slot.mark_failure(exc, threshold=self.failure_threshold, cooldown_seconds=self.cooldown_seconds)
                last_exc = exc
                continue

        if last_exc is not None:
            raise RuntimeError(f"All providers failed for method '{method}': {last_exc}") from last_exc
        raise RuntimeError(f"No provider could service method '{method}'")

    def health_snapshot(self) -> dict[str, list[dict[str, Any]]]:
        def _row(slot: _ProviderSlot) -> dict[str, Any]:
            return {
                "name": slot.name,
                "priority": slot.priority,
                "failures": slot.failures,
                "last_error": slot.last_error,
                "last_success_at": slot.last_success_at.isoformat() if slot.last_success_at else None,
                "suspended_until": slot.suspended_until.isoformat() if slot.suspended_until else None,
                "available": slot.can_run(),
            }

        return {
            "market": [_row(s) for s in self._market],
            "crypto": [_row(s) for s in self._crypto],
        }
