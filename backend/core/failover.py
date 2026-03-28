from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class FailoverSlot:
    name: str
    target: Any
    priority: int = 0
    failures: int = 0
    last_error: str | None = None
    last_success_at: datetime | None = None
    suspended_until: datetime | None = None

    def available(self) -> bool:
        return self.suspended_until is None or now_utc() >= self.suspended_until

    def mark_success(self) -> None:
        self.failures = 0
        self.last_error = None
        self.last_success_at = now_utc()
        self.suspended_until = None

    def mark_failure(self, exc: Exception, *, threshold: int, cooldown_seconds: int) -> None:
        self.failures += 1
        self.last_error = str(exc)
        if self.failures >= threshold:
            self.suspended_until = now_utc() + timedelta(seconds=max(1, cooldown_seconds))

    def snapshot(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "priority": self.priority,
            "failures": self.failures,
            "last_error": self.last_error,
            "last_success_at": self.last_success_at.isoformat() if self.last_success_at else None,
            "suspended_until": self.suspended_until.isoformat() if self.suspended_until else None,
            "available": self.available(),
        }


async def call_with_failover(
    chain: list[FailoverSlot],
    method: str,
    *args: Any,
    failure_threshold: int,
    cooldown_seconds: int,
    **kwargs: Any,
) -> Any:
    if not chain:
        raise RuntimeError("No providers registered")

    last_exc: Exception | None = None
    for slot in chain:
        if not slot.available():
            continue
        fn = getattr(slot.target, method, None)
        if fn is None:
            continue
        try:
            result = await fn(*args, **kwargs)
            slot.mark_success()
            return result
        except Exception as exc:
            slot.mark_failure(exc, threshold=failure_threshold, cooldown_seconds=cooldown_seconds)
            last_exc = exc

    if last_exc is not None:
        raise RuntimeError(f"All providers failed for method '{method}': {last_exc}") from last_exc
    raise RuntimeError(f"No provider could service method '{method}'")
