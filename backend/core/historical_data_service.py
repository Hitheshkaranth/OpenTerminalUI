from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Protocol

import pandas as pd
import yfinance as yf

from backend.core.symbols import Symbol, normalize_symbol


@dataclass(frozen=True)
class OhlcvBar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class HistoricalDataProvider(Protocol):
    def get_daily_ohlcv(self, symbol: Symbol, start: str, end: str) -> list[OhlcvBar]:
        ...


class YahooHistoricalDataProvider:
    def get_daily_ohlcv(self, symbol: Symbol, start: str, end: str) -> list[OhlcvBar]:
        frame = yf.download(
            symbol.provider_symbol,
            start=start,
            end=end,
            auto_adjust=False,
            progress=False,
        )
        if frame.empty:
            return []
        if isinstance(frame.columns, pd.MultiIndex):
            # yf can return a single-symbol multi-index frame in some versions
            frame.columns = frame.columns.get_level_values(0)
        rows: list[OhlcvBar] = []
        for idx, row in frame.iterrows():
            rows.append(
                OhlcvBar(
                    date=idx.strftime("%Y-%m-%d"),
                    open=float(row.get("Open", 0.0)),
                    high=float(row.get("High", 0.0)),
                    low=float(row.get("Low", 0.0)),
                    close=float(row.get("Close", 0.0)),
                    volume=int(row.get("Volume", 0) or 0),
                )
            )
        return rows


class HistoricalDataService:
    def __init__(self, provider: HistoricalDataProvider | None = None) -> None:
        self._provider = provider or YahooHistoricalDataProvider()

    def fetch_daily_ohlcv(
        self,
        raw_symbol: str,
        market: str = "NSE",
        start: str | None = None,
        end: str | None = None,
        limit: int = 500,
    ) -> tuple[Symbol, list[OhlcvBar]]:
        symbol = normalize_symbol(raw_symbol, market)
        end_val = end or date.today().isoformat()
        start_val = start or "2000-01-01"
        bars = self._provider.get_daily_ohlcv(symbol, start=start_val, end=end_val)
        if limit > 0:
            bars = bars[-limit:]
        return symbol, bars


_historical_data_service = HistoricalDataService()


def get_historical_data_service() -> HistoricalDataService:
    return _historical_data_service
