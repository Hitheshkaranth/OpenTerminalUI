from __future__ import annotations

import asyncio
import csv
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from pydantic import BaseModel
from zoneinfo import ZoneInfo

from backend.db.database import SessionLocal
from backend.db.models import FutureContract


class StockClassification(BaseModel):
    symbol: str
    display_name: str
    exchange: str
    country_code: str
    country_name: str
    flag_emoji: str
    currency: str
    has_futures: bool
    has_options: bool
    market_status: str


EXCHANGE_COUNTRY_MAP = {
    "NSE": {"country_code": "IN", "country_name": "India", "flag_emoji": "🇮🇳", "currency": "INR"},
    "BSE": {"country_code": "IN", "country_name": "India", "flag_emoji": "🇮🇳", "currency": "INR"},
    "NYSE": {"country_code": "US", "country_name": "United States", "flag_emoji": "🇺🇸", "currency": "USD"},
    "NASDAQ": {"country_code": "US", "country_name": "United States", "flag_emoji": "🇺🇸", "currency": "USD"},
    "AMEX": {"country_code": "US", "country_name": "United States", "flag_emoji": "🇺🇸", "currency": "USD"},
    "LSE": {"country_code": "GB", "country_name": "United Kingdom", "flag_emoji": "🇬🇧", "currency": "GBP"},
    "TSE": {"country_code": "JP", "country_name": "Japan", "flag_emoji": "🇯🇵", "currency": "JPY"},
    "HKSE": {"country_code": "HK", "country_name": "Hong Kong", "flag_emoji": "🇭🇰", "currency": "HKD"},
    "ASX": {"country_code": "AU", "country_name": "Australia", "flag_emoji": "🇦🇺", "currency": "AUD"},
    "TSX": {"country_code": "CA", "country_name": "Canada", "flag_emoji": "🇨🇦", "currency": "CAD"},
    "XETRA": {"country_code": "DE", "country_name": "Germany", "flag_emoji": "🇩🇪", "currency": "EUR"},
    "EURONEXT": {"country_code": "FR", "country_name": "France", "flag_emoji": "🇫🇷", "currency": "EUR"},
}

_US_EXCHANGES = {"NYSE", "NASDAQ", "AMEX"}
_NSE_SYMBOLS: set[str] | None = None
_NSE_LOCK = asyncio.Lock()


def _country_flag_emoji(country_code: str) -> str:
    code = (country_code or "").strip().upper()
    if len(code) != 2 or not code.isalpha():
        return ""
    return chr(0x1F1E6 + ord(code[0]) - ord("A")) + chr(0x1F1E6 + ord(code[1]) - ord("A"))


def _market_status_for_exchange(exchange: str) -> str:
    ex = (exchange or "").strip().upper()
    now_utc = datetime.now(timezone.utc)
    weekday = now_utc.weekday()
    if weekday >= 5:
        return "closed"

    if ex in {"NSE", "BSE"}:
        local = now_utc.astimezone(ZoneInfo("Asia/Kolkata"))
        now_min = local.hour * 60 + local.minute
        if 9 * 60 + 15 <= now_min <= 15 * 60 + 30:
            return "open"
        return "closed"

    if ex in _US_EXCHANGES:
        local = now_utc.astimezone(ZoneInfo("America/New_York"))
        now_min = local.hour * 60 + local.minute
        if 4 * 60 <= now_min < 9 * 60 + 30:
            return "pre-market"
        if 9 * 60 + 30 <= now_min < 16 * 60:
            return "open"
        if 16 * 60 <= now_min < 20 * 60:
            return "post-market"
        return "closed"

    return "closed"


class MarketClassifier:
    _cache_ttl = timedelta(days=7)

    def __init__(self) -> None:
        self._cache: dict[str, tuple[datetime, StockClassification]] = {}
        self._cache_lock = asyncio.Lock()
        self._http = httpx.AsyncClient(timeout=12.0, trust_env=False, follow_redirects=True)
        self._fmp_key = os.getenv("FMP_API_KEY", "").strip()

    async def close(self) -> None:
        await self._http.aclose()

    async def _load_nse_symbols(self) -> set[str]:
        global _NSE_SYMBOLS
        if _NSE_SYMBOLS is not None:
            return _NSE_SYMBOLS
        async with _NSE_LOCK:
            if _NSE_SYMBOLS is not None:
                return _NSE_SYMBOLS
            data_dir = Path(__file__).resolve().parents[2] / "data"
            files = [data_dir / "nse_equity_symbols_eq.csv", data_dir / "nse_equity_symbols_all.csv"]
            out: set[str] = set()
            for file_path in files:
                if not file_path.exists():
                    continue
                try:
                    with file_path.open("r", encoding="utf-8") as f:
                        rows = csv.DictReader(f)
                        for row in rows:
                            symbol = (row.get("Symbol") or row.get("SYMBOL") or "").strip().upper()
                            if symbol:
                                out.add(symbol)
                except Exception:
                    continue
            _NSE_SYMBOLS = out
            return _NSE_SYMBOLS

    async def _fetch_fmp_profile(self, symbol: str) -> dict[str, Any]:
        if not self._fmp_key:
            return {}
        candidates = [symbol]
        if "." not in symbol:
            candidates.extend([f"{symbol}.NS", f"{symbol}.BO"])
        for cand in candidates:
            try:
                resp = await self._http.get(
                    f"https://financialmodelingprep.com/api/v3/profile/{cand}",
                    params={"apikey": self._fmp_key},
                )
                resp.raise_for_status()
                payload = resp.json()
                if isinstance(payload, list) and payload:
                    first = payload[0]
                    if isinstance(first, dict):
                        return first
            except Exception:
                continue
        return {}

    def _country_meta_from_profile(self, profile: dict[str, Any]) -> dict[str, str]:
        country_raw = str(profile.get("country") or "").strip()
        if len(country_raw) == 2:
            code = country_raw.upper()
            return {
                "country_code": code,
                "country_name": code,
                "flag_emoji": _country_flag_emoji(code),
                "currency": str(profile.get("currency") or "USD"),
            }
        low = country_raw.lower()
        fallback: dict[str, tuple[str, str, str]] = {
            "india": ("IN", "India", "INR"),
            "united states": ("US", "United States", "USD"),
            "usa": ("US", "United States", "USD"),
            "united kingdom": ("GB", "United Kingdom", "GBP"),
            "japan": ("JP", "Japan", "JPY"),
            "hong kong": ("HK", "Hong Kong", "HKD"),
            "australia": ("AU", "Australia", "AUD"),
            "canada": ("CA", "Canada", "CAD"),
            "germany": ("DE", "Germany", "EUR"),
            "france": ("FR", "France", "EUR"),
        }
        code, name, currency = fallback.get(low, ("US", country_raw or "Unknown", str(profile.get("currency") or "USD")))
        return {"country_code": code, "country_name": name, "flag_emoji": _country_flag_emoji(code), "currency": currency}

    async def _has_indian_fo(self, symbol: str) -> bool:
        base = symbol.strip().upper()
        if base.endswith(".NS") or base.endswith(".BO"):
            base = base.split(".", 1)[0]

        def _query() -> bool:
            db = SessionLocal()
            try:
                row = (
                    db.query(FutureContract.id)
                    .filter(FutureContract.underlying == base)
                    .first()
                )
                return row is not None
            finally:
                db.close()

        try:
            return await asyncio.to_thread(_query)
        except Exception:
            return False

    async def classify(self, symbol: str) -> StockClassification:
        input_symbol = symbol.strip().upper()
        now = datetime.now(timezone.utc)
        async with self._cache_lock:
            cached = self._cache.get(input_symbol)
            if cached and cached[0] > now:
                return cached[1]

        base_symbol = input_symbol
        exchange = ""
        profile: dict[str, Any] = {}

        if input_symbol.endswith(".NS"):
            base_symbol = input_symbol[:-3]
            exchange = "NSE"
        elif input_symbol.endswith(".BO"):
            base_symbol = input_symbol[:-3]
            exchange = "BSE"

        if not exchange:
            nse_symbols = await self._load_nse_symbols()
            if input_symbol in nse_symbols:
                exchange = "NSE"

        if not exchange:
            profile = await self._fetch_fmp_profile(input_symbol)
            exchange = str(profile.get("exchangeShortName") or profile.get("exchange") or "").strip().upper()

        if not exchange:
            exchange = "NSE" if input_symbol in (await self._load_nse_symbols()) else "NASDAQ"

        ex_meta = EXCHANGE_COUNTRY_MAP.get(exchange)
        if ex_meta is None and profile:
            ex_meta = self._country_meta_from_profile(profile)
        if ex_meta is None:
            ex_meta = {"country_code": "US", "country_name": "United States", "flag_emoji": "🇺🇸", "currency": "USD"}

        display_name = str(
            profile.get("companyName")
            or profile.get("name")
            or base_symbol
        ).strip() or base_symbol

        if ex_meta["country_code"] == "IN":
            has_futures = await self._has_indian_fo(base_symbol)
            has_options = has_futures
        elif exchange in _US_EXCHANGES:
            has_futures = False
            has_options = True
        else:
            has_futures = False
            has_options = False

        classified = StockClassification(
            symbol=base_symbol,
            display_name=display_name,
            exchange=exchange,
            country_code=ex_meta["country_code"],
            country_name=ex_meta["country_name"],
            flag_emoji=ex_meta["flag_emoji"] or _country_flag_emoji(ex_meta["country_code"]),
            currency=str(profile.get("currency") or ex_meta["currency"] or "USD"),
            has_futures=has_futures,
            has_options=has_options,
            market_status=_market_status_for_exchange(exchange),
        )

        async with self._cache_lock:
            self._cache[input_symbol] = (now + self._cache_ttl, classified)
        return classified

    async def yfinance_symbol(self, symbol: str) -> str:
        raw = symbol.strip().upper()
        if raw.startswith("^") or "=" in raw:
            return raw
        if raw.endswith(".NS") or raw.endswith(".BO"):
            return raw
        cls = await self.classify(raw)
        if cls.country_code == "IN":
            suffix = ".BO" if cls.exchange == "BSE" else ".NS"
            return f"{cls.symbol}{suffix}"
        return cls.symbol


market_classifier = MarketClassifier()
