"""
Mutual Fund data service for Indian mutual funds.

Data sources:
1. AMFI NAV API (free, no key): https://www.amfiindia.com/spages/NAVAll.txt
2. MFAPI (free): https://api.mfapi.in/mf/{scheme_code}
3. FMP Mutual Fund API (optional, API key): holdings only (not used for NAV math here)
"""
from __future__ import annotations

import asyncio
import math
import time
from datetime import date, datetime, timedelta
from typing import Any, Optional

import httpx
from pydantic import BaseModel

from backend.shared.cache import cache


class MutualFund(BaseModel):
    scheme_code: int
    scheme_name: str
    isin_growth: Optional[str] = None
    isin_div_payout: Optional[str] = None
    nav: float
    nav_date: date
    fund_house: str
    scheme_type: str
    scheme_category: str
    scheme_sub_category: str


class MutualFundNAVHistory(BaseModel):
    scheme_code: int
    scheme_name: str
    nav_history: list[dict[str, Any]]


class MutualFundPerformance(BaseModel):
    scheme_code: int
    scheme_name: str
    fund_house: str
    category: str
    current_nav: float
    returns_1m: Optional[float] = None
    returns_3m: Optional[float] = None
    returns_6m: Optional[float] = None
    returns_1y: Optional[float] = None
    returns_3y: Optional[float] = None
    returns_5y: Optional[float] = None
    returns_since_inception: Optional[float] = None
    expense_ratio: Optional[float] = None
    aum_cr: Optional[float] = None
    risk_rating: Optional[str] = None


def _safe_float(value: Any) -> Optional[float]:
    if value in (None, "", "-", "NA", "N/A"):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(out):
        return None
    return out


def _infer_scheme_category(sub_category: str) -> str:
    low = (sub_category or "").lower()
    if "equity" in low or "large cap" in low or "mid cap" in low or "small cap" in low or "elss" in low:
        return "Equity"
    if "debt" in low or "liquid" in low or "gilt" in low or "bond" in low:
        return "Debt"
    if "hybrid" in low or "balanced" in low or "arbitrage" in low:
        return "Hybrid"
    if "solution oriented" in low or "retirement" in low or "children" in low:
        return "Solution Oriented"
    return "Other"


def _fund_house_from_name(name: str, fallback: str) -> str:
    clean = (name or "").strip()
    if not clean:
        return fallback or "Unknown"
    parts = clean.split()
    if len(parts) >= 2:
        return " ".join(parts[:2])
    return parts[0]


def _parse_mfapi_date(text: str) -> Optional[date]:
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _parse_amfi_date(text: str) -> Optional[date]:
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


class MutualFundService:
    AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
    MFAPI_BASE = "https://api.mfapi.in/mf"
    _AMFI_TTL = 6 * 60 * 60
    _NAV_HISTORY_TTL = 24 * 60 * 60
    _TOP_FUNDS_TTL = 6 * 60 * 60

    def __init__(self) -> None:
        self._mfapi_semaphore = asyncio.Semaphore(10)
        self._mfapi_rate_lock = asyncio.Lock()
        self._next_mfapi_allowed = 0.0

    async def _rate_limit_mfapi(self) -> None:
        # 2 req/sec: keep 0.5 sec minimum spacing globally.
        async with self._mfapi_rate_lock:
            now = time.monotonic()
            wait_s = self._next_mfapi_allowed - now
            if wait_s > 0:
                await asyncio.sleep(wait_s)
                now = time.monotonic()
            self._next_mfapi_allowed = max(now, self._next_mfapi_allowed) + 0.5

    async def _fetch_amfi_rows(self) -> list[MutualFund]:
        cache_key = cache.build_key("mutual_funds_amfi", "all", {})
        cached = await cache.get(cache_key)
        if isinstance(cached, list) and cached:
            return [MutualFund(**row) if isinstance(row, dict) else row for row in cached]

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, trust_env=False) as client:
            resp = await client.get(self.AMFI_NAV_URL)
            resp.raise_for_status()
            text = resp.text

        rows: list[MutualFund] = []
        scheme_type = "Unknown"
        scheme_sub_category = "Unknown"
        scheme_category = "Other"
        fund_house = "Unknown"

        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("Scheme Code"):
                continue

            if ";" in line:
                parts = line.split(";")
                if len(parts) < 8:
                    continue
                code = parts[0].strip()
                if not code.isdigit():
                    continue
                nav = _safe_float(parts[4].strip())
                nav_dt = _parse_amfi_date(parts[7].strip())
                if nav is None or nav_dt is None:
                    continue
                name = parts[3].strip()
                rows.append(
                    MutualFund(
                        scheme_code=int(code),
                        scheme_name=name,
                        isin_div_payout=(parts[1].strip() or None),
                        isin_growth=(parts[2].strip() or None),
                        nav=nav,
                        nav_date=nav_dt,
                        fund_house=fund_house or _fund_house_from_name(name, "Unknown"),
                        scheme_type=scheme_type,
                        scheme_category=scheme_category,
                        scheme_sub_category=scheme_sub_category,
                    )
                )
                continue

            low = line.lower()
            if "ended schemes" in low:
                scheme_type = line
                continue
            if "scheme -" in low:
                # Example: "Equity Scheme - Large Cap Fund"
                scheme_sub_category = line.split("-", 1)[-1].strip() or line
                scheme_category = _infer_scheme_category(line)
                continue
            # Mostly fund house separators
            fund_house = line

        await cache.set(cache_key, [x.model_dump() for x in rows], ttl=self._AMFI_TTL)
        return rows

    async def search_funds(self, query: str, category: Optional[str] = None) -> list[MutualFund]:
        funds = await self._fetch_amfi_rows()
        q = (query or "").strip().lower()
        cat = (category or "").strip().lower()

        out: list[MutualFund] = []
        for fund in funds:
            if q:
                code_match = q.isdigit() and str(fund.scheme_code).startswith(q)
                name_match = q in fund.scheme_name.lower()
                if not (code_match or name_match):
                    continue
            if cat:
                pool = f"{fund.scheme_category} {fund.scheme_sub_category}".lower()
                if cat not in pool:
                    continue
            out.append(fund)

        out.sort(key=lambda x: x.scheme_name.lower())
        return out[:50]

    async def _fetch_mfapi_json(self, scheme_code: int) -> dict[str, Any]:
        async with self._mfapi_semaphore:
            await self._rate_limit_mfapi()
            async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, trust_env=False) as client:
                resp = await client.get(f"{self.MFAPI_BASE}/{scheme_code}")
                resp.raise_for_status()
                payload = resp.json()
                if not isinstance(payload, dict):
                    raise ValueError("MFAPI returned non-object response")
                return payload

    async def get_fund_nav_history(self, scheme_code: int) -> MutualFundNAVHistory:
        cache_key = cache.build_key("mutual_funds_nav_history", str(scheme_code), {})
        cached = await cache.get(cache_key)
        if isinstance(cached, dict):
            return MutualFundNAVHistory(**cached)

        payload = await self._fetch_mfapi_json(scheme_code)
        scheme_name = str(payload.get("meta", {}).get("scheme_name") or f"Scheme {scheme_code}")
        data = payload.get("data", [])
        history: list[dict[str, Any]] = []
        if isinstance(data, list):
            for row in data:
                if not isinstance(row, dict):
                    continue
                dt = _parse_mfapi_date(str(row.get("date", "")))
                nav = _safe_float(row.get("nav"))
                if dt is None or nav is None:
                    continue
                history.append({"date": dt.isoformat(), "nav": nav})
        history.sort(key=lambda x: x["date"])

        out = MutualFundNAVHistory(scheme_code=scheme_code, scheme_name=scheme_name, nav_history=history)
        await cache.set(cache_key, out.model_dump(), ttl=self._NAV_HISTORY_TTL)
        return out

    @staticmethod
    def _nav_on_or_before(history: list[tuple[date, float]], target: date) -> Optional[float]:
        chosen: Optional[float] = None
        for dt, nav in history:
            if dt <= target:
                chosen = nav
            else:
                break
        return chosen

    @staticmethod
    def _simple_return(current_nav: float, past_nav: Optional[float]) -> Optional[float]:
        if past_nav is None or past_nav <= 0:
            return None
        return ((current_nav - past_nav) / past_nav) * 100.0

    @staticmethod
    def _cagr(current_nav: float, past_nav: Optional[float], years: float) -> Optional[float]:
        if past_nav is None or past_nav <= 0 or years <= 0:
            return None
        return ((current_nav / past_nav) ** (1.0 / years) - 1.0) * 100.0

    async def get_fund_performance(self, scheme_code: int) -> MutualFundPerformance:
        nav_hist = await self.get_fund_nav_history(scheme_code)
        if not nav_hist.nav_history:
            raise ValueError(f"No NAV history found for scheme code {scheme_code}")

        hist: list[tuple[date, float]] = []
        for row in nav_hist.nav_history:
            dt = _parse_mfapi_date(str(row.get("date", ""))) or _parse_amfi_date(str(row.get("date", "")))
            nav = _safe_float(row.get("nav"))
            if dt is None or nav is None:
                continue
            hist.append((dt, nav))
        hist.sort(key=lambda x: x[0])
        if not hist:
            raise ValueError(f"No valid NAV points found for scheme code {scheme_code}")

        current_date, current_nav = hist[-1]
        one_month = current_date - timedelta(days=30)
        three_month = current_date - timedelta(days=90)
        six_month = current_date - timedelta(days=180)
        one_year = current_date - timedelta(days=365)
        three_year = current_date - timedelta(days=365 * 3)
        five_year = current_date - timedelta(days=365 * 5)

        first_date, first_nav = hist[0]
        inception_years = max((current_date - first_date).days / 365.25, 0.0)
        three_years = max((current_date - three_year).days / 365.25, 0.0)
        five_years = max((current_date - five_year).days / 365.25, 0.0)

        amfi_map = {x.scheme_code: x for x in await self._fetch_amfi_rows()}
        meta = amfi_map.get(scheme_code)
        fund_house = meta.fund_house if meta else "Unknown"
        category = meta.scheme_sub_category if meta else "Other"

        return MutualFundPerformance(
            scheme_code=scheme_code,
            scheme_name=nav_hist.scheme_name,
            fund_house=fund_house,
            category=category,
            current_nav=current_nav,
            returns_1m=self._simple_return(current_nav, self._nav_on_or_before(hist, one_month)),
            returns_3m=self._simple_return(current_nav, self._nav_on_or_before(hist, three_month)),
            returns_6m=self._simple_return(current_nav, self._nav_on_or_before(hist, six_month)),
            returns_1y=self._simple_return(current_nav, self._nav_on_or_before(hist, one_year)),
            returns_3y=self._cagr(current_nav, self._nav_on_or_before(hist, three_year), three_years),
            returns_5y=self._cagr(current_nav, self._nav_on_or_before(hist, five_year), five_years),
            returns_since_inception=self._cagr(current_nav, first_nav, inception_years),
            expense_ratio=None,
            aum_cr=None,
            risk_rating=None,
        )

    async def compare_funds(self, scheme_codes: list[int], period: str = "1y") -> list[MutualFundPerformance]:
        perf = await asyncio.gather(*(self.get_fund_performance(code) for code in scheme_codes), return_exceptions=True)
        rows = [x for x in perf if isinstance(x, MutualFundPerformance)]

        key_map = {
            "1m": "returns_1m",
            "3m": "returns_3m",
            "6m": "returns_6m",
            "1y": "returns_1y",
            "3y": "returns_3y",
            "5y": "returns_5y",
        }
        key = key_map.get(period, "returns_1y")
        rows.sort(key=lambda x: getattr(x, key) if getattr(x, key) is not None else float("-inf"), reverse=True)
        return rows

    async def get_top_funds_by_category(
        self,
        category: str,
        sort_by: str = "returns_1y",
        limit: int = 20,
    ) -> list[MutualFundPerformance]:
        cache_key = cache.build_key(
            "mutual_funds_top_category",
            category,
            {"sort_by": sort_by, "limit": limit},
        )
        cached = await cache.get(cache_key)
        if isinstance(cached, list):
            return [MutualFundPerformance(**x) if isinstance(x, dict) else x for x in cached]

        all_funds = await self._fetch_amfi_rows()
        cat = (category or "").strip().lower()
        matched_codes = [
            x.scheme_code
            for x in all_funds
            if cat in f"{x.scheme_category} {x.scheme_sub_category}".lower()
        ]

        sem = asyncio.Semaphore(10)

        async def _one(code: int) -> Optional[MutualFundPerformance]:
            async with sem:
                try:
                    return await self.get_fund_performance(code)
                except Exception:
                    return None

        perf = await asyncio.gather(*(_one(code) for code in matched_codes))
        rows = [x for x in perf if isinstance(x, MutualFundPerformance)]
        rows.sort(
            key=lambda x: getattr(x, sort_by) if hasattr(x, sort_by) and getattr(x, sort_by) is not None else float("-inf"),
            reverse=True,
        )
        out = rows[: max(1, min(limit, 100))]
        await cache.set(cache_key, [x.model_dump() for x in out], ttl=self._TOP_FUNDS_TTL)
        return out

    async def get_fund_meta(self, scheme_code: int) -> Optional[MutualFund]:
        all_funds = await self._fetch_amfi_rows()
        for fund in all_funds:
            if fund.scheme_code == scheme_code:
                return fund
        return None

    async def get_normalized_history(
        self,
        scheme_codes: list[int],
        period: str = "1y",
    ) -> dict[int, list[dict[str, Any]]]:
        days_map = {
            "1m": 30,
            "3m": 90,
            "6m": 180,
            "1y": 365,
            "3y": 365 * 3,
            "5y": 365 * 5,
        }
        days = days_map.get(period, 365)
        out: dict[int, list[dict[str, Any]]] = {}
        for code in scheme_codes:
            try:
                hist = await self.get_fund_nav_history(code)
            except Exception:
                out[code] = []
                continue
            rows: list[tuple[date, float]] = []
            for row in hist.nav_history:
                dt = _parse_mfapi_date(str(row.get("date", ""))) or _parse_amfi_date(str(row.get("date", "")))
                nav = _safe_float(row.get("nav"))
                if dt is None or nav is None:
                    continue
                rows.append((dt, nav))
            rows.sort(key=lambda x: x[0])
            if not rows:
                out[code] = []
                continue
            end_dt = rows[-1][0]
            start_cut = end_dt - timedelta(days=days)
            filtered = [(d, n) for d, n in rows if d >= start_cut]
            if not filtered:
                filtered = rows
            base = filtered[0][1]
            if base <= 0:
                out[code] = []
                continue
            out[code] = [{"date": d.isoformat(), "value": (n / base) * 100.0} for d, n in filtered]
        return out


mutual_fund_service = MutualFundService()
