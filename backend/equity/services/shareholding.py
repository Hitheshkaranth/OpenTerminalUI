"""
NSE India shareholding pattern scraper.
Fetches quarterly shareholding data from NSE India website.
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

from backend.shared.cache import cache


class ShareholdingCategory(BaseModel):
    category: str
    percentage: float
    shares: Optional[int] = None
    quarter: str


class ShareholdingPattern(BaseModel):
    symbol: str
    total_shares: int = 0
    promoter_holding: float = 0.0
    fii_holding: float = 0.0
    dii_holding: float = 0.0
    public_holding: float = 0.0
    government_holding: float = 0.0
    categories: list[ShareholdingCategory] = Field(default_factory=list)
    quarter: str
    as_of_date: str
    historical: list[dict] = Field(default_factory=list)
    source: str = "nse"
    institutional_holders: list[dict[str, Any]] = Field(default_factory=list)
    warning: Optional[str] = None


def _to_float(value: Any) -> float:
    if value in (None, "", "-", "NA", "N/A"):
        return 0.0
    try:
        out = float(value)
        if out != out:
            return 0.0
        return out
    except (TypeError, ValueError):
        return 0.0


def _to_int(value: Any) -> Optional[int]:
    if value in (None, "", "-", "NA", "N/A"):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _normalize_symbol(symbol: str) -> str:
    raw = symbol.strip().upper()
    if "." in raw:
        return raw.split(".", 1)[0]
    return raw


def _is_non_nse_symbol(symbol: str) -> bool:
    # Typical non-NSE formats: AAPL, MSFT, TSLA, BRK.B
    # NSE symbols are usually plain uppercase without dot, often <= 15 chars.
    raw = symbol.strip().upper()
    return "." in raw or "-" in raw


def _quarter_sort_key(label: str) -> datetime:
    txt = (label or "").strip()
    for fmt in ("%b %Y", "%B %Y", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(txt, fmt)
        except ValueError:
            continue
    return datetime.min


def _model_to_dict(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()  # type: ignore[attr-defined]
    return model.dict()


def _default_pattern_payload(symbol: str, warning: Optional[str] = None) -> dict[str, Any]:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    quarter = "Latest"
    categories = [
        {
            "category": "Public Shareholders",
            "percentage": 100.0,
            "shares": None,
            "quarter": quarter,
        }
    ]
    historical = [
        {
            "quarter": quarter,
            "promoter": 0.0,
            "fii": 0.0,
            "dii": 0.0,
            "public": 100.0,
            "government": 0.0,
        }
    ]
    return {
        "symbol": symbol,
        "total_shares": 0,
        "promoter_holding": 0.0,
        "fii_holding": 0.0,
        "dii_holding": 0.0,
        "public_holding": 100.0,
        "government_holding": 0.0,
        "categories": categories,
        "quarter": quarter,
        "as_of_date": today,
        "historical": historical,
        "source": "fallback",
        "institutional_holders": [],
        "warning": warning,
    }


class ShareholdingService:
    """
    Primary source: NSE India corporate governance API
    Fallback: FMP institutional holders API (for non-NSE stocks)
    """

    NSE_BASE = "https://www.nseindia.com"
    NSE_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Referer": "https://www.nseindia.com/",
        "Connection": "keep-alive",
    }
    SHAREHOLDING_TTL = 86400

    async def get_nse_session(self) -> httpx.AsyncClient:
        client = httpx.AsyncClient(
            headers=self.NSE_HEADERS,
            follow_redirects=True,
            timeout=15.0,
            trust_env=False,
        )
        await client.get(self.NSE_BASE)
        return client

    def _extract_rows(self, payload: Any) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []

        def _walk(node: Any) -> None:
            if isinstance(node, dict):
                values = list(node.values())
                if values and all(isinstance(v, (str, int, float, type(None))) for v in values):
                    keys = {k.lower() for k in node.keys()}
                    if any(
                        k in keys
                        for k in (
                            "category",
                            "shareholdercategory",
                            "shareholder",
                            "shareholding",
                            "perc",
                            "percentage",
                            "noshares",
                            "noofshares",
                        )
                    ):
                        rows.append(node)
                for value in values:
                    _walk(value)
            elif isinstance(node, list):
                for item in node:
                    _walk(item)

        _walk(payload)
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for row in rows:
            marker = str(sorted(row.items()))
            if marker in seen:
                continue
            seen.add(marker)
            out.append(row)
        return out

    def _category_name(self, row: dict[str, Any]) -> str:
        for key in (
            "category",
            "shareholderCategory",
            "shareholdercategory",
            "shareHolderCategory",
            "shareholder",
            "name",
            "label",
            "description",
        ):
            value = row.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return "Unknown"

    def _category_percentage(self, row: dict[str, Any]) -> float:
        for key in (
            "percentage",
            "perc",
            "per",
            "holding",
            "shareholding",
            "percent",
            "value",
            "sharePercentage",
            "sharepercentage",
        ):
            if key in row:
                return _to_float(row.get(key))
        return 0.0

    def _category_shares(self, row: dict[str, Any]) -> Optional[int]:
        for key in ("shares", "share", "noOfShares", "noofshares", "noshares", "numberOfShares"):
            if key in row:
                return _to_int(row.get(key))
        return None

    def _row_quarter(self, row: dict[str, Any], default_quarter: str) -> str:
        for key in ("quarter", "period", "date", "asOnDate", "asondt"):
            value = row.get(key)
            if isinstance(value, str) and value.strip():
                raw = value.strip()
                parsed = self._parse_date(raw)
                if parsed:
                    return parsed.strftime("%b %Y")
                return raw
        return default_quarter

    def _parse_date(self, value: str) -> Optional[datetime]:
        txt = value.strip()
        for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d-%m-%Y", "%d %b %Y", "%b %Y", "%B %Y"):
            try:
                return datetime.strptime(txt, fmt)
            except ValueError:
                continue
        return None

    def _extract_meta(self, payload: dict[str, Any], categories: list[ShareholdingCategory]) -> tuple[str, str, int]:
        quarter = ""
        as_of_date = ""
        total_shares = 0

        for key in ("quarter", "period", "asOnDate", "date"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                parsed = self._parse_date(value)
                if parsed:
                    quarter = parsed.strftime("%b %Y")
                    as_of_date = parsed.strftime("%Y-%m-%d")
                else:
                    quarter = value.strip()
                break

        for key in ("totalShares", "totalshares", "issuedCapital", "issuedcapital", "noOfShares"):
            value = payload.get(key)
            parsed = _to_int(value)
            if parsed:
                total_shares = parsed
                break

        if not quarter and categories:
            quarter = categories[0].quarter

        if not as_of_date and quarter:
            parsed_q = self._parse_date(quarter)
            if parsed_q:
                as_of_date = parsed_q.strftime("%Y-%m-%d")

        return quarter or "Latest", as_of_date or datetime.utcnow().strftime("%Y-%m-%d"), total_shares

    def _classify_category(self, name: str) -> str:
        low = name.lower()
        if "promoter" in low:
            return "promoter"
        if "government" in low or "central government" in low or "state government" in low:
            return "government"
        if "foreign" in low or "fpi" in low or "fii" in low or "portfolio investor" in low:
            return "fii"
        if any(
            token in low
            for token in (
                "mutual fund",
                "insurance",
                "bank",
                "financial institution",
                "fi ",
                "alternate investment",
                "pension",
                "domestic institutional",
                "venture capital",
                "institutional",
            )
        ):
            return "dii"
        return "public"

    def _aggregate(self, categories: list[ShareholdingCategory]) -> dict[str, float]:
        bucket = {"promoter": 0.0, "fii": 0.0, "dii": 0.0, "public": 0.0, "government": 0.0}
        for row in categories:
            slot = self._classify_category(row.category)
            bucket[slot] += float(row.percentage)

        total = sum(bucket.values())
        if total < 99.0:
            bucket["public"] += max(0.0, 100.0 - total)
        return {k: round(v, 2) for k, v in bucket.items()}

    def _historical_from_categories(self, categories: list[ShareholdingCategory], quarters: int = 8) -> list[dict]:
        grouped: dict[str, list[ShareholdingCategory]] = {}
        for row in categories:
            grouped.setdefault(row.quarter, []).append(row)

        ordered = sorted(grouped.keys(), key=_quarter_sort_key, reverse=True)[:quarters]
        out: list[dict] = []
        for q in ordered:
            agg = self._aggregate(grouped[q])
            out.append(
                {
                    "quarter": q,
                    "promoter": agg["promoter"],
                    "fii": agg["fii"],
                    "dii": agg["dii"],
                    "public": agg["public"],
                    "government": agg["government"],
                }
            )
        return out

    async def _fetch_nse_shareholding_payload(self, symbol: str) -> dict[str, Any]:
        endpoint = f"{self.NSE_BASE}/api/corporate-share-holding"
        client = await self.get_nse_session()
        try:
            resp = await client.get(endpoint, params={"symbol": symbol, "issuer": "company"})
            resp.raise_for_status()
            payload = resp.json()
            return payload if isinstance(payload, dict) else {}
        finally:
            await client.aclose()

    async def get_shareholding(self, symbol: str) -> ShareholdingPattern:
        clean_symbol = _normalize_symbol(symbol)
        cache_key = cache.build_key("shareholding", clean_symbol, {})
        cached = await cache.get(cache_key)
        if isinstance(cached, dict):
            return ShareholdingPattern(**cached)

        if _is_non_nse_symbol(clean_symbol):
            fallback = await self.get_fmp_institutional(clean_symbol)
            pattern = ShareholdingPattern(**fallback)
            await cache.set(cache_key, _model_to_dict(pattern), ttl=self.SHAREHOLDING_TTL)
            return pattern

        warning: Optional[str] = None
        payload: dict[str, Any] = {}
        try:
            payload = await self._fetch_nse_shareholding_payload(clean_symbol)
        except Exception as exc:
            warning = f"NSE shareholding unavailable: {exc}"

        rows = self._extract_rows(payload)
        categories: list[ShareholdingCategory] = []
        fallback_quarter = ""
        for row in rows:
            category = self._category_name(row)
            percentage = self._category_percentage(row)
            shares = self._category_shares(row)
            if percentage <= 0.0 and shares is None:
                continue
            quarter = self._row_quarter(row, fallback_quarter or "Latest")
            if quarter and not fallback_quarter:
                fallback_quarter = quarter
            categories.append(
                ShareholdingCategory(
                    category=category,
                    percentage=round(percentage, 2),
                    shares=shares,
                    quarter=quarter,
                )
            )

        if not categories:
            fallback = await self.get_fmp_institutional(clean_symbol)
            if warning:
                fallback["warning"] = warning
            # Ensure frontend always has a meaningful payload.
            if not fallback.get("categories"):
                base = _default_pattern_payload(clean_symbol, fallback.get("warning"))
                fallback = {**base, **fallback}
                fallback["categories"] = base["categories"]
                fallback["historical"] = fallback.get("historical") or base["historical"]
            pattern = ShareholdingPattern(**fallback)
            await cache.set(cache_key, _model_to_dict(pattern), ttl=self.SHAREHOLDING_TTL)
            return pattern

        quarter, as_of_date, total_shares = self._extract_meta(payload, categories)
        current_quarter_categories = [row for row in categories if row.quarter == quarter] or categories
        agg = self._aggregate(current_quarter_categories)
        historical = self._historical_from_categories(categories, quarters=8)
        if len(historical) < 2:
            historical = await self.get_historical_shareholding(clean_symbol, quarters=8)

        pattern = ShareholdingPattern(
            symbol=clean_symbol,
            total_shares=total_shares,
            promoter_holding=agg["promoter"],
            fii_holding=agg["fii"],
            dii_holding=agg["dii"],
            public_holding=agg["public"],
            government_holding=agg["government"],
            categories=current_quarter_categories,
            quarter=quarter,
            as_of_date=as_of_date,
            historical=historical,
            source="nse",
            warning=warning,
        )
        await cache.set(cache_key, _model_to_dict(pattern), ttl=self.SHAREHOLDING_TTL)
        return pattern

    async def get_historical_shareholding(self, symbol: str, quarters: int = 8) -> list[dict]:
        clean_symbol = _normalize_symbol(symbol)
        cache_key = cache.build_key("shareholding_trend", clean_symbol, {"quarters": quarters})
        cached = await cache.get(cache_key)
        if isinstance(cached, list):
            return cached

        out: list[dict] = []
        try:
            payload = await self._fetch_nse_shareholding_payload(clean_symbol)
            rows = self._extract_rows(payload)
            categories: list[ShareholdingCategory] = []
            fallback_quarter = "Latest"
            for row in rows:
                pct = self._category_percentage(row)
                if pct <= 0.0:
                    continue
                quarter = self._row_quarter(row, fallback_quarter)
                categories.append(
                    ShareholdingCategory(
                        category=self._category_name(row),
                        percentage=round(pct, 2),
                        shares=self._category_shares(row),
                        quarter=quarter,
                    )
                )
            out = self._historical_from_categories(categories, quarters=quarters)
        except Exception:
            out = []

        # Fallback snapshot for non-NSE / missing history.
        if not out:
            fmp_payload = await self.get_fmp_institutional(clean_symbol)
            if fmp_payload.get("historical"):
                out = fmp_payload["historical"]
            else:
                out = _default_pattern_payload(clean_symbol).get("historical", [])

        await cache.set(cache_key, out, ttl=self.SHAREHOLDING_TTL)
        return out

    async def get_fmp_institutional(self, symbol: str) -> dict:
        api_key = os.getenv("FMP_API_KEY", "").strip()
        holders: list[dict[str, Any]] = []
        warning: Optional[str] = None

        if not api_key:
            warning = "FMP_API_KEY not configured"
        else:
            endpoint = f"https://financialmodelingprep.com/api/v3/institutional-holder/{symbol}"
            try:
                async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, trust_env=False) as client:
                    response = await client.get(endpoint, params={"apikey": api_key})
                    response.raise_for_status()
                    payload = response.json()
                    if isinstance(payload, list):
                        for row in payload[:50]:
                            if not isinstance(row, dict):
                                continue
                            holder_name = str(
                                row.get("holder")
                                or row.get("holderName")
                                or row.get("investorName")
                                or "Institutional Holder"
                            )
                            shares = _to_int(row.get("shares") or row.get("sharesNumber") or row.get("position"))
                            change = _to_float(row.get("change") or row.get("changeInShares"))
                            holders.append(
                                {
                                    "holder": holder_name,
                                    "shares": shares or 0,
                                    "change": round(change, 2),
                                    "date_reported": str(row.get("dateReported") or row.get("reportDate") or ""),
                                }
                            )
            except Exception as exc:
                warning = f"FMP institutional fallback unavailable: {exc}"

        quarter = "Latest"
        as_of = datetime.utcnow().strftime("%Y-%m-%d")
        payload = _default_pattern_payload(symbol, warning)
        payload["source"] = "fmp"
        payload["institutional_holders"] = holders
        payload["quarter"] = quarter
        payload["as_of_date"] = as_of
        return payload
