from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import date
from typing import Any


class MarketDataProvider(ABC):
    """Contract for equity/derivatives market data providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def supported_asset_classes(self) -> tuple[str, ...]:
        raise NotImplementedError

    @abstractmethod
    async def search_symbols(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    async def get_quote(self, symbol: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def get_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        start: date | None = None,
        end: date | None = None,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError


class CryptoDataProvider(ABC):
    """Contract for crypto market data providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        raise NotImplementedError

    @abstractmethod
    async def get_spot_markets(self, limit: int = 100) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    async def get_quote(self, symbol: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    async def get_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        start: date | None = None,
        end: date | None = None,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    async def get_top_movers(self, metric: str = "change_24h", limit: int = 20) -> list[dict[str, Any]]:
        raise NotImplementedError
