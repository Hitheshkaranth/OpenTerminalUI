from __future__ import annotations

import asyncio

from backend.shared.circuit_breaker import CircuitBreaker


def test_decorated_sync_function_returns_value_inside_running_loop():
    cb = CircuitBreaker()

    @cb.call()
    def add(a, b):
        return a + b

    async def main():
        return add(1, 2)

    assert asyncio.run(main()) == 3


def test_decorated_async_function_is_awaitable():
    cb = CircuitBreaker()

    @cb.call()
    async def mul(a, b):
        return a * b

    assert asyncio.run(mul(3, 4)) == 12
