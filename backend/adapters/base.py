from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from typing import Any


@dataclass
class QuoteResponse:
    symbol: str
    price: float
    change: float = 0.0
    change_pct: float = 0.0
    currency: str | None = None
    ts: str | None = None


@dataclass
class OHLCV:
    t: int
    o: float
    h: float
    l: float
    c: float
    v: float = 0.0


@dataclass
class Instrument:
    symbol: str
    name: str
    exchange: str
    currency: str | None = None


@dataclass
class OptionContract:
    symbol: str
    underlying: str
    expiry: str
    strike: float
    option_type: str
    ltp: float
    bid: float = 0.0
    ask: float = 0.0
    iv: float = 0.0
    delta: float = 0.0
    gamma: float = 0.0
    theta: float = 0.0
    vega: float = 0.0
    rho: float = 0.0
    oi: int = 0
    oi_change: int = 0
    volume: int = 0
    lot_size: int = 1


@dataclass
class OptionChain:
    underlying: str
    spot_price: float
    expiry: str
    contracts: list[OptionContract]
    pcr_oi: float = 0.0
    pcr_volume: float = 0.0
    max_pain: float | None = None
    timestamp: str = ""


@dataclass
class FuturesContract:
    symbol: str
    underlying: str
    expiry: str
    ltp: float
    basis: float = 0.0
    basis_pct: float = 0.0
    annualized_basis: float = 0.0
    oi: int = 0
    volume: int = 0
    lot_size: int = 1
    change: float = 0.0
    change_pct: float = 0.0


class DataAdapter(ABC):
    @abstractmethod
    async def get_quote(self, symbol: str) -> QuoteResponse | None: ...

    @abstractmethod
    async def get_history(self, symbol: str, timeframe: str, start: date, end: date) -> list[OHLCV]: ...

    @abstractmethod
    async def search_instruments(self, query: str) -> list[Instrument]: ...

    @abstractmethod
    async def get_fundamentals(self, symbol: str) -> dict[str, Any]: ...

    @abstractmethod
    async def supports_streaming(self) -> bool: ...

    @abstractmethod
    async def get_option_chain(
        self, underlying: str, expiry: date
    ) -> OptionChain | None:
        """Return option chain for underlying + expiry. None if unsupported."""
        ...

    @abstractmethod
    async def get_futures_chain(
        self, underlying: str
    ) -> list[FuturesContract]:
        """Return all active futures contracts for underlying."""
        ...
