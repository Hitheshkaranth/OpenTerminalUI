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
