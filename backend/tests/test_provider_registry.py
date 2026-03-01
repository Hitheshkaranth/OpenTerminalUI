from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from backend.adapters.provider_contracts import CryptoDataProvider, MarketDataProvider
from backend.services.provider_registry import ProviderRegistry


class _FailingMarket(MarketDataProvider):
    @property
    def name(self) -> str:
        return "failing-market"

    @property
    def supported_asset_classes(self) -> tuple[str, ...]:
        return ("equity",)

    async def search_symbols(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        raise RuntimeError("down")

    async def get_quote(self, symbol: str) -> dict[str, Any]:
        raise RuntimeError("down")

    async def get_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        start: date | None = None,
        end: date | None = None,
    ) -> list[dict[str, Any]]:
        raise RuntimeError("down")


class _HealthyMarket(MarketDataProvider):
    @property
    def name(self) -> str:
        return "healthy-market"

    @property
    def supported_asset_classes(self) -> tuple[str, ...]:
        return ("equity",)

    async def search_symbols(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        return [{"symbol": "AAPL", "name": "Apple Inc"}]

    async def get_quote(self, symbol: str) -> dict[str, Any]:
        return {"symbol": symbol, "price": 123.45}

    async def get_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        start: date | None = None,
        end: date | None = None,
    ) -> list[dict[str, Any]]:
        return [{"t": 1, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10.0}]


class _HealthyCrypto(CryptoDataProvider):
    @property
    def name(self) -> str:
        return "healthy-crypto"

    async def get_spot_markets(self, limit: int = 100) -> list[dict[str, Any]]:
        return [{"symbol": "BTC-USD"}]

    async def get_quote(self, symbol: str) -> dict[str, Any]:
        return {"symbol": symbol, "price": 50000.0}

    async def get_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        start: date | None = None,
        end: date | None = None,
    ) -> list[dict[str, Any]]:
        return [{"t": 1, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 99.0}]

    async def get_top_movers(self, metric: str = "change_24h", limit: int = 20) -> list[dict[str, Any]]:
        return [{"symbol": "BTC-USD", "change_24h": 2.0}]


@pytest.mark.asyncio
async def test_market_fallback_uses_next_provider() -> None:
    registry = ProviderRegistry(failure_threshold=1, cooldown_seconds=60)
    registry.register_market(_FailingMarket(), priority=10)
    registry.register_market(_HealthyMarket(), priority=20)

    quote = await registry.call_market("get_quote", "AAPL")
    assert quote["symbol"] == "AAPL"
    assert quote["price"] == 123.45

    health = registry.health_snapshot()
    assert health["market"][0]["name"] == "failing-market"
    assert health["market"][0]["available"] is False
    assert health["market"][1]["name"] == "healthy-market"
    assert health["market"][1]["available"] is True


@pytest.mark.asyncio
async def test_crypto_registry_calls_registered_provider() -> None:
    registry = ProviderRegistry()
    registry.register_crypto(_HealthyCrypto(), priority=1)

    movers = await registry.call_crypto("get_top_movers", "change_24h", 5)
    assert isinstance(movers, list)
    assert movers[0]["symbol"] == "BTC-USD"
