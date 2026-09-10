from __future__ import annotations

import asyncio
import functools
import logging
import time
from enum import Enum
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreakerError(Exception):
    """Raised when a call is attempted while the circuit is open."""

    def __init__(self, state: CircuitState, failure_count: int) -> None:
        self.state = state
        self.failure_count = failure_count
        super().__init__(f"Circuit breaker is {state.value} after {failure_count} failures")


class CircuitBreaker:
    """Implements the circuit-breaker pattern for external service calls.

    States
    ------
    CLOSED  – normal operation. Failures are counted; when count reaches
              *failure_threshold* the circuit transitions to OPEN.
    OPEN    – calls are rejected immediately. After *recovery_timeout* the
              circuit moves to HALF_OPEN.
    HALF_OPEN – the next call is allowed through. If it succeeds the circuit
                closes; if it fails the circuit re-opens.

    Usage as a context manager
    --------------------------
    >>> cb = CircuitBreaker(failure_threshold=3, recovery_timeout=30)
    >>> with cb():
    ...     result = call_external_api()

    Usage as a decorator
    --------------------
    >>> @CircuitBreaker(failure_threshold=3, recovery_timeout=30).call()
    ... def call_external_api(): ...

    Async support
    -------------
    >>> async with cb():
    ...     result = await call_external_api()
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        success_threshold: int = 2,
    ) -> None:
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.success_threshold = success_threshold

        self._state: CircuitState = CircuitState.CLOSED
        self._failure_count: int = 0
        self._success_count: int = 0
        self._last_failure_time: float = 0.0

    @property
    def state(self) -> CircuitState:
        if self._state == CircuitState.OPEN:
            if time.monotonic() - self._last_failure_time >= self.recovery_timeout:
                self._state = CircuitState.HALF_OPEN
                self._success_count = 0
                logger.info("Circuit breaker '%s' transitioned to HALF_OPEN", self._get_id())
        return self._state

    def _get_id(self) -> str:
        return f"cb:{hash(self)}"

    def __call__(self) -> CircuitBreakerContext:
        return CircuitBreakerContext(self)

    def call(self, wrapped: Optional[Callable] = None, **kwargs: Any) -> Any:
        """Decorator usage: @circuit_breaker.call() or @circuit_breaker.call(failure_threshold=3)"""
        if kwargs:
            partial_cb = CircuitBreaker(**kwargs)
            return self._apply_decorator(partial_cb)
        if wrapped is not None:
            return self._apply_decorator(self)
        return self._apply_decorator(self)

    def _apply_decorator(self, cb: "CircuitBreaker") -> Callable:
        def decorator(func: Callable) -> Callable:
            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                async with cb():
                    return await func(*args, **kwargs)

            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                with cb():
                    return func(*args, **kwargs)

            @functools.wraps(func)
            def choose_wrapper(*args: Any, **kwargs: Any) -> Any:
                try:
                    asyncio.get_running_loop()
                    return async_wrapper(*args, **kwargs)
                except RuntimeError:
                    return sync_wrapper(*args, **kwargs)

            return choose_wrapper

        return decorator

    def _on_success(self) -> None:
        self._failure_count = 0
        if self._state == CircuitState.HALF_OPEN:
            self._success_count += 1
            if self._success_count >= self.success_threshold:
                self._state = CircuitState.CLOSED
                self._success_count = 0
                logger.info("Circuit breaker '%s' transitioned to CLOSED", self._get_id())
        elif self._state == CircuitState.CLOSED:
            self._success_count += 1

    def _on_failure(self) -> None:
        self._last_failure_time = time.monotonic()
        if self._state == CircuitState.HALF_OPEN:
            self._state = CircuitState.OPEN
            logger.warning("Circuit breaker '%s' transitioned to OPEN after HALF_OPEN failure", self._get_id())
        else:
            self._failure_count += 1
            if self._failure_count >= self.failure_threshold:
                self._state = CircuitState.OPEN
                logger.warning(
                    "Circuit breaker '%s' transitioned to OPEN after %d failures",
                    self._get_id(),
                    self._failure_count,
                )

    def reset(self) -> None:
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time = 0.0


class CircuitBreakerContext:
    """Context manager for circuit breaker with sync and async support."""

    def __init__(self, circuit_breaker: CircuitBreaker) -> None:
        self._cb = circuit_breaker

    def __enter__(self) -> "CircuitBreakerContext":
        state = self._cb.state
        if state == CircuitState.OPEN:
            raise CircuitBreakerError(state, self._cb._failure_count)  # noqa: SLF001
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> bool:
        if exc_type is not None:
            self._cb._on_failure()
        else:
            self._cb._on_success()
        return False

    async def __aenter__(self) -> "CircuitBreakerContext":
        state = self._cb.state
        if state == CircuitState.OPEN:
            raise CircuitBreakerError(state, self._cb._failure_count)  # noqa: SLF001
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if exc_type is not None:
            self._cb._on_failure()
        else:
            self._cb._on_success()