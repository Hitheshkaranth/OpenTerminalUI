from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd
import yfinance as yf


@dataclass
class MarketDataFetcher:
    """Fetches market and fundamental data for a ticker universe."""

    default_exchange_suffix: str = ".NS"

    def _normalized_ticker(self, ticker: str) -> str:
        t = ticker.strip().upper()
        if "." not in t and self.default_exchange_suffix:
            return f"{t}{self.default_exchange_suffix}"
        return t

    def fetch_history(
        self,
        ticker: str,
        period: str = "1y",
        interval: str = "1d",
    ) -> pd.DataFrame:
        symbol = self._normalized_ticker(ticker)
        tk = yf.Ticker(symbol)
        try:
            hist = tk.history(period=period, interval=interval, auto_adjust=False)
            if isinstance(hist, pd.DataFrame) and not hist.empty:
                return hist
        except Exception:
            pass
        # Fallback to download API when Ticker.history endpoint fails.
        try:
            data = yf.download(symbol, period=period, interval=interval, auto_adjust=False, progress=False)
            if isinstance(data, pd.DataFrame):
                return data
        except Exception:
            pass
        return pd.DataFrame()

    def fetch_fundamental_snapshot(self, ticker: str) -> dict[str, Any]:
        symbol = self._normalized_ticker(ticker)
        tk = yf.Ticker(symbol)
        info: dict[str, Any] = {}
        try:
            info = tk.info or {}
        except Exception:
            info = {}
        # Add selected fast_info fallback keys when info payload fails.
        try:
            fi = tk.fast_info
            if fi:
                info.setdefault("currentPrice", fi.get("lastPrice"))
                info.setdefault("dayHigh", fi.get("dayHigh"))
                info.setdefault("dayLow", fi.get("dayLow"))
                info.setdefault("marketCap", fi.get("marketCap"))
                info.setdefault("volume", fi.get("lastVolume"))
                info.setdefault("fiftyTwoWeekHigh", fi.get("yearHigh"))
                info.setdefault("fiftyTwoWeekLow", fi.get("yearLow"))
        except Exception:
            pass

        try:
            income_stmt = tk.income_stmt if tk.income_stmt is not None else pd.DataFrame()
        except Exception:
            income_stmt = pd.DataFrame()
        try:
            balance_sheet = tk.balance_sheet if tk.balance_sheet is not None else pd.DataFrame()
        except Exception:
            balance_sheet = pd.DataFrame()
        try:
            cashflow = tk.cashflow if tk.cashflow is not None else pd.DataFrame()
        except Exception:
            cashflow = pd.DataFrame()
        return {
            "ticker": ticker.strip().upper(),
            "symbol": symbol,
            "info": info,
            "income_stmt": income_stmt,
            "balance_sheet": balance_sheet,
            "cashflow": cashflow,
            "history_1y": self.fetch_history(ticker, period="1y", interval="1d"),
        }
