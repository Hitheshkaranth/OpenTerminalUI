from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
from typing import Any

import pandas as pd
import requests
import yfinance as yf

_YF_CACHE_DIR = Path(__file__).resolve().parents[2] / ".yf_cache"
_YF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
_HTTP = requests.Session()
_HTTP.trust_env = False
# In many local setups proxy env vars are stale/broken; by default bypass them for market data.
if os.getenv("LTS_DISABLE_PROXY", "1") == "1":
    for proxy_key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]:
        os.environ.pop(proxy_key, None)
    os.environ["NO_PROXY"] = "*"
    os.environ["no_proxy"] = "*"
try:
    yf.set_tz_cache_location(str(_YF_CACHE_DIR))
except Exception:
    pass


@dataclass
class MarketDataFetcher:
    default_exchange_suffix: str = ".NS"
    request_timeout_seconds: int = 4

    _consecutive_failures: int = 0
    _blocked_until_utc: datetime | None = None

    def normalized_ticker(self, ticker: str) -> str:
        t = ticker.strip().upper()
        if "." not in t and self.default_exchange_suffix:
            return f"{t}{self.default_exchange_suffix}"
        return t

    def _network_allowed(self) -> bool:
        if self._blocked_until_utc is None:
            return True
        return datetime.now(timezone.utc) >= self._blocked_until_utc

    def _mark_network_success(self) -> None:
        self._consecutive_failures = 0
        self._blocked_until_utc = None

    def _mark_network_failure(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= 3:
            self._blocked_until_utc = datetime.now(timezone.utc) + timedelta(seconds=120)

    def fetch_history(self, ticker: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
        if not self._network_allowed():
            return pd.DataFrame()
        symbol = self.normalized_ticker(ticker)
        # Prefer direct chart endpoint first to avoid noisy yfinance parser failures.
        try:
            fallback = self._fetch_history_chart_api(symbol=symbol, period=period, interval=interval)
            if isinstance(fallback, pd.DataFrame) and not fallback.empty:
                self._mark_network_success()
                return fallback
        except Exception:
            self._mark_network_failure()

        tk = yf.Ticker(symbol)
        try:
            hist = tk.history(period=period, interval=interval, auto_adjust=False, timeout=self.request_timeout_seconds)
            if isinstance(hist, pd.DataFrame) and not hist.empty:
                self._mark_network_success()
                return hist
        except Exception:
            self._mark_network_failure()

        try:
            data = yf.download(
                symbol,
                period=period,
                interval=interval,
                auto_adjust=False,
                progress=False,
                timeout=self.request_timeout_seconds,
            )
            if isinstance(data, pd.DataFrame) and not data.empty:
                self._mark_network_success()
                return data
        except Exception:
            self._mark_network_failure()
        return pd.DataFrame()

    def _fetch_history_chart_api(self, symbol: str, period: str, interval: str) -> pd.DataFrame:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        params = {"range": period, "interval": interval, "events": "div,splits"}
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json,text/plain,*/*",
        }
        response = _HTTP.get(url, params=params, headers=headers, timeout=self.request_timeout_seconds)
        response.raise_for_status()
        payload = response.json()
        chart = (payload.get("chart") or {}).get("result") or []
        if not chart:
            return pd.DataFrame()
        node = chart[0]
        ts = node.get("timestamp") or []
        quote = (((node.get("indicators") or {}).get("quote") or [{}])[0]) or {}
        if not ts:
            return pd.DataFrame()
        df = pd.DataFrame(
            {
                "Open": quote.get("open") or [],
                "High": quote.get("high") or [],
                "Low": quote.get("low") or [],
                "Close": quote.get("close") or [],
                "Volume": quote.get("volume") or [],
            }
        )
        if df.empty:
            return pd.DataFrame()
        dt_index = [datetime.fromtimestamp(int(x), tz=timezone.utc) for x in ts[: len(df)]]
        df = df.iloc[: len(dt_index)].copy()
        df.index = pd.DatetimeIndex(dt_index)
        return df.dropna(how="all")

    def _fetch_quote_api(self, symbol: str) -> dict[str, Any]:
        url = "https://query1.finance.yahoo.com/v7/finance/quote"
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json,text/plain,*/*",
        }
        response = _HTTP.get(url, params={"symbols": symbol}, headers=headers, timeout=self.request_timeout_seconds)
        response.raise_for_status()
        payload = response.json()
        node = ((payload.get("quoteResponse") or {}).get("result") or [{}])[0] or {}
        return {
            "shortName": node.get("shortName"),
            "longName": node.get("longName"),
            "marketCap": node.get("marketCap"),
            "currentPrice": node.get("regularMarketPrice"),
            "trailingPE": node.get("trailingPE"),
            "forwardPE": node.get("forwardPE"),
            "priceToBook": node.get("priceToBook"),
            "priceToSalesTrailing12Months": node.get("priceToSalesTrailing12Months"),
            "enterpriseValue": node.get("enterpriseValue"),
            "ebitda": node.get("ebitda"),
            "beta": node.get("beta"),
            "dividendYield": node.get("dividendYield"),
            "fiftyTwoWeekHigh": node.get("fiftyTwoWeekHigh"),
            "fiftyTwoWeekLow": node.get("fiftyTwoWeekLow"),
        }

    def _fetch_nse_quote_api(self, ticker: str) -> dict[str, Any]:
        base_symbol = ticker.strip().upper().split(".")[0]
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json,text/plain,*/*",
            "Referer": "https://www.nseindia.com/",
        }
        basic = _HTTP.get(
            "https://www.nseindia.com/api/quote-equity",
            params={"symbol": base_symbol},
            headers=headers,
            timeout=self.request_timeout_seconds,
        )
        basic.raise_for_status()
        basic_obj = basic.json()

        trade = _HTTP.get(
            "https://www.nseindia.com/api/quote-equity",
            params={"symbol": base_symbol, "section": "trade_info"},
            headers=headers,
            timeout=self.request_timeout_seconds,
        )
        trade.raise_for_status()
        trade_obj = trade.json()

        info = basic_obj.get("info") or {}
        industry_info = basic_obj.get("industryInfo") or {}
        metadata = basic_obj.get("metadata") or {}
        price_info = basic_obj.get("priceInfo") or {}
        week_hl = price_info.get("weekHighLow") or {}
        trade_info = ((trade_obj.get("marketDeptOrderBook") or {}).get("tradeInfo") or {})

        pe = metadata.get("pdSymbolPe")
        try:
            pe_val = float(pe) if pe not in (None, "", "-") else None
        except (TypeError, ValueError):
            pe_val = None
        current_price = price_info.get("lastPrice")
        try:
            current_price_val = float(current_price) if current_price is not None else None
        except (TypeError, ValueError):
            current_price_val = None

        market_cap_cr = trade_info.get("totalMarketCap")
        try:
            market_cap_val = float(market_cap_cr) * 10_000_000 if market_cap_cr is not None else None
        except (TypeError, ValueError):
            market_cap_val = None

        trailing_eps = (current_price_val / pe_val) if current_price_val and pe_val and pe_val > 0 else None

        return {
            "shortName": info.get("companyName"),
            "longName": info.get("companyName"),
            "industry": industry_info.get("industry") or info.get("industry"),
            "currentPrice": current_price_val,
            "marketCap": market_cap_val,
            "trailingPE": pe_val,
            "trailingEps": trailing_eps,
            "fiftyTwoWeekHigh": week_hl.get("max"),
            "fiftyTwoWeekLow": week_hl.get("min"),
        }

    def fetch_fundamental_snapshot(
        self,
        ticker: str,
        include_history: bool = False,
        include_full_info: bool = False,
        include_statements: bool = False,
    ) -> dict[str, Any]:
        symbol = self.normalized_ticker(ticker)
        info: dict[str, Any] = {}
        tk = yf.Ticker(symbol)
        if self._network_allowed():
            if include_full_info:
                try:
                    info = tk.info or {}
                    self._mark_network_success()
                except Exception:
                    info = {}
                    self._mark_network_failure()
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
                    self._mark_network_success()
            except Exception:
                self._mark_network_failure()
            # Yahoo quote endpoint fallback for core market metrics (works in many cases when .info fails).
            if include_full_info or not info:
                try:
                    quote_info = self._fetch_quote_api(symbol)
                    for key, val in quote_info.items():
                        if val is not None:
                            info.setdefault(key, val)
                    self._mark_network_success()
                except Exception:
                    self._mark_network_failure()
        # NSE quote fallback: keep this outside cooldown gate so we still recover market metrics.
        if not info or info.get("marketCap") is None or info.get("trailingPE") is None:
            try:
                nse_info = self._fetch_nse_quote_api(ticker)
                for key, val in nse_info.items():
                    if val is not None:
                        info.setdefault(key, val)
                self._mark_network_success()
            except Exception:
                self._mark_network_failure()

        def _safe_df(getter: str) -> pd.DataFrame:
            if not self._network_allowed() or not include_statements:
                return pd.DataFrame()
            try:
                val = getattr(tk, getter)
                self._mark_network_success()
                return val if isinstance(val, pd.DataFrame) else pd.DataFrame()
            except Exception:
                self._mark_network_failure()
                return pd.DataFrame()

        return {
            "ticker": ticker.strip().upper(),
            "symbol": symbol,
            "info": info,
            "income_stmt": _safe_df("income_stmt"),
            "quarterly_income_stmt": _safe_df("quarterly_income_stmt"),
            "balance_sheet": _safe_df("balance_sheet"),
            "quarterly_balance_sheet": _safe_df("quarterly_balance_sheet"),
            "cashflow": _safe_df("cashflow"),
            "quarterly_cashflow": _safe_df("quarterly_cashflow"),
            "history_1y": self.fetch_history(ticker, period="1y", interval="1d") if include_history else pd.DataFrame(),
        }
