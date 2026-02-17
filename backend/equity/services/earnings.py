from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from typing import Any, Optional

import yfinance as yf
from pydantic import BaseModel

from backend.api.deps import get_unified_fetcher
from backend.shared.cache import cache


class EarningsDate(BaseModel):
    symbol: str
    company_name: str
    earnings_date: date
    fiscal_quarter: str
    fiscal_year: int
    quarter: int
    estimated_eps: Optional[float] = None
    actual_eps: Optional[float] = None
    eps_surprise: Optional[float] = None
    eps_surprise_pct: Optional[float] = None
    estimated_revenue: Optional[float] = None
    actual_revenue: Optional[float] = None
    revenue_surprise: Optional[float] = None
    revenue_surprise_pct: Optional[float] = None
    time: str = "unknown"
    source: str


class QuarterlyFinancial(BaseModel):
    symbol: str
    quarter: str
    quarter_end_date: date
    revenue: float
    revenue_qoq_pct: Optional[float] = None
    revenue_yoy_pct: Optional[float] = None
    net_profit: float
    net_profit_qoq_pct: Optional[float] = None
    net_profit_yoy_pct: Optional[float] = None
    operating_profit: Optional[float] = None
    operating_margin_pct: Optional[float] = None
    net_margin_pct: Optional[float] = None
    ebitda: Optional[float] = None
    eps: Optional[float] = None
    eps_qoq_pct: Optional[float] = None
    eps_yoy_pct: Optional[float] = None


class EarningsAnalysis(BaseModel):
    symbol: str
    company_name: str
    next_earnings_date: Optional[EarningsDate] = None
    last_earnings: Optional[EarningsDate] = None
    quarterly_financials: list[QuarterlyFinancial]
    revenue_trend: str
    profit_trend: str
    consecutive_beats: int
    avg_eps_surprise_pct: float


def _parse_date(raw: Any) -> Optional[date]:
    if raw is None:
        return None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    if isinstance(raw, datetime):
        return raw.date()
    text = str(raw).strip()
    if not text:
        return None
    for fmt in (
        "%Y-%m-%d",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%d-%m-%Y",
        "%d/%m/%Y",
    ):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except Exception:
        return None


def _to_float(value: Any) -> Optional[float]:
    if value in (None, "", "NA", "N/A", "-", "null", "None"):
        return None
    try:
        out = float(value)
        if out != out:
            return None
        return out
    except Exception:
        return None


def _pct_change(cur: Optional[float], prev: Optional[float]) -> Optional[float]:
    if cur is None or prev is None or prev == 0:
        return None
    return ((cur - prev) / abs(prev)) * 100.0


def _fy_quarter(day: date) -> tuple[int, int, str]:
    # India-style FY labeling (Apr-Mar).
    if day.month in (4, 5, 6):
        q = 1
        fy = day.year + 1
    elif day.month in (7, 8, 9):
        q = 2
        fy = day.year + 1
    elif day.month in (10, 11, 12):
        q = 3
        fy = day.year + 1
    else:
        q = 4
        fy = day.year
    return fy, q, f"Q{q} FY{fy}"


def _trend_from_yoy(values: list[Optional[float]]) -> str:
    pts = [v for v in values if v is not None]
    if len(pts) < 2:
        return "stable"
    tail3 = pts[-3:]
    if len(tail3) >= 2 and all(v < 0 for v in tail3[-2:]):
        return "declining"
    if len(tail3) == 3 and tail3[2] > tail3[1] > tail3[0]:
        return "accelerating"
    if len(tail3) == 3 and tail3[2] < tail3[1] < tail3[0] and all(v > 0 for v in tail3):
        return "decelerating"
    tail4 = pts[-4:]
    if len(tail4) >= 3:
        spread = max(tail4) - min(tail4)
        if spread < 5:
            return "stable"
    return "stable"


class EarningsService:
    CALENDAR_TTL_SECONDS = 6 * 60 * 60
    FINANCIALS_TTL_SECONDS = 24 * 60 * 60
    ANALYSIS_TTL_SECONDS = 24 * 60 * 60

    async def _finnhub_calendar(self, from_date: date, to_date: date) -> list[EarningsDate]:
        fetcher = await get_unified_fetcher()
        payload = await fetcher.finnhub._get(
            "/calendar/earnings",
            {"from": from_date.isoformat(), "to": to_date.isoformat()},
        )
        rows = payload.get("earningsCalendar") if isinstance(payload, dict) else []
        out: list[EarningsDate] = []
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("symbol") or "").strip().upper().replace(".NS", "")
            earnings_date = _parse_date(row.get("date"))
            if not symbol or not earnings_date:
                continue
            fy, q, label = _fy_quarter(earnings_date)
            est_eps = _to_float(row.get("epsEstimate"))
            actual_eps = _to_float(row.get("epsActual"))
            eps_surprise = _to_float(row.get("epsSurprise"))
            eps_surprise_pct = _to_float(row.get("epsSurprisePercent"))
            est_rev = _to_float(row.get("revenueEstimate"))
            actual_rev = _to_float(row.get("revenueActual"))
            rev_surprise = None if est_rev is None or actual_rev is None else (actual_rev - est_rev)
            rev_surprise_pct = _pct_change(actual_rev, est_rev)
            out.append(
                EarningsDate(
                    symbol=symbol,
                    company_name=str(row.get("company") or symbol),
                    earnings_date=earnings_date,
                    fiscal_quarter=label,
                    fiscal_year=fy,
                    quarter=q,
                    estimated_eps=est_eps,
                    actual_eps=actual_eps,
                    eps_surprise=eps_surprise,
                    eps_surprise_pct=eps_surprise_pct,
                    estimated_revenue=est_rev,
                    actual_revenue=actual_rev,
                    revenue_surprise=rev_surprise,
                    revenue_surprise_pct=rev_surprise_pct,
                    time=str(row.get("hour") or "unknown").lower(),
                    source="finnhub",
                )
            )
        return out

    async def _fmp_calendar(self, from_date: date, to_date: date) -> list[EarningsDate]:
        fetcher = await get_unified_fetcher()
        payload = await fetcher.fmp._get(
            "/earning_calendar",
            {"from": from_date.isoformat(), "to": to_date.isoformat()},
        )
        rows = payload if isinstance(payload, list) else []
        out: list[EarningsDate] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            raw_symbol = str(row.get("symbol") or "").strip().upper()
            symbol = raw_symbol.replace(".NS", "")
            earnings_date = _parse_date(row.get("date"))
            if not symbol or not earnings_date:
                continue
            fy, q, label = _fy_quarter(earnings_date)
            est_eps = _to_float(row.get("epsEstimated"))
            actual_eps = _to_float(row.get("eps"))
            eps_surprise = None if est_eps is None or actual_eps is None else (actual_eps - est_eps)
            eps_surprise_pct = _pct_change(actual_eps, est_eps)
            est_rev = _to_float(row.get("revenueEstimated"))
            actual_rev = _to_float(row.get("revenue"))
            rev_surprise = None if est_rev is None or actual_rev is None else (actual_rev - est_rev)
            rev_surprise_pct = _pct_change(actual_rev, est_rev)
            out.append(
                EarningsDate(
                    symbol=symbol,
                    company_name=str(row.get("company") or symbol),
                    earnings_date=earnings_date,
                    fiscal_quarter=label,
                    fiscal_year=fy,
                    quarter=q,
                    estimated_eps=est_eps,
                    actual_eps=actual_eps,
                    eps_surprise=eps_surprise,
                    eps_surprise_pct=eps_surprise_pct,
                    estimated_revenue=est_rev,
                    actual_revenue=actual_rev,
                    revenue_surprise=rev_surprise,
                    revenue_surprise_pct=rev_surprise_pct,
                    time=str(row.get("time") or "unknown").lower(),
                    source="fmp",
                )
            )
        return out

    @staticmethod
    def _dedupe_calendar(items: list[EarningsDate]) -> list[EarningsDate]:
        seen: set[str] = set()
        out: list[EarningsDate] = []
        # Finnhub first for date reliability.
        for row in sorted(items, key=lambda x: (x.source != "finnhub", x.earnings_date, x.symbol)):
            key = f"{row.symbol}|{row.earnings_date.isoformat()}"
            if key in seen:
                continue
            seen.add(key)
            out.append(row)
        out.sort(key=lambda x: x.earnings_date)
        return out

    async def get_earnings_calendar(
        self,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        symbols: Optional[list[str]] = None,
    ) -> list[EarningsDate]:
        start = from_date or date.today()
        end = to_date or (start + timedelta(days=90))
        clean_symbols = [x.strip().upper() for x in (symbols or []) if x and x.strip()]
        cache_key = cache.build_key(
            "earnings_calendar",
            "ALL",
            {
                "from": start.isoformat(),
                "to": end.isoformat(),
                "symbols": clean_symbols,
            },
        )
        cached = await cache.get(cache_key)
        if isinstance(cached, list):
            return [EarningsDate(**x) if isinstance(x, dict) else x for x in cached]

        finnhub_rows, fmp_rows = await asyncio.gather(
            self._finnhub_calendar(start, end),
            self._fmp_calendar(start, end),
            return_exceptions=True,
        )
        merged: list[EarningsDate] = []
        if not isinstance(finnhub_rows, Exception):
            merged.extend(finnhub_rows)
        if not isinstance(fmp_rows, Exception):
            merged.extend(fmp_rows)

        merged = self._dedupe_calendar(merged)
        if clean_symbols:
            symbol_set = set(clean_symbols)
            merged = [x for x in merged if x.symbol in symbol_set]
        merged = [x for x in merged if start <= x.earnings_date <= end]

        await cache.set(cache_key, [x.model_dump() for x in merged], ttl=self.CALENDAR_TTL_SECONDS)
        return merged

    async def get_next_earnings(self, symbol: str) -> Optional[EarningsDate]:
        today = date.today()
        rows = await self.get_earnings_calendar(from_date=today, to_date=today + timedelta(days=180), symbols=[symbol])
        for row in rows:
            if row.earnings_date >= today:
                return row
        return None

    async def _quarterly_from_fmp(self, symbol: str, limit: int) -> list[dict[str, Any]]:
        fetcher = await get_unified_fetcher()
        rows = await fetcher.fmp.get_income_statement(symbol, period="quarter", limit=max(limit, 16))
        return rows if isinstance(rows, list) else []

    async def _quarterly_from_yfinance(self, symbol: str) -> list[dict[str, Any]]:
        yf_symbol = symbol.upper()
        if "." not in yf_symbol:
            yf_symbol = f"{yf_symbol}.NS"

        def _read() -> list[dict[str, Any]]:
            ticker = yf.Ticker(yf_symbol)
            frame = ticker.quarterly_income_stmt
            if frame is None or frame.empty:
                frame = ticker.quarterly_financials
            if frame is None or frame.empty:
                return []
            cols = list(frame.columns)
            out: list[dict[str, Any]] = []
            for col in cols:
                if hasattr(col, "date"):
                    report_date = col.date().isoformat()
                else:
                    parsed = _parse_date(col)
                    report_date = parsed.isoformat() if parsed else None
                if not report_date:
                    continue
                rev = frame.at["Total Revenue", col] if "Total Revenue" in frame.index else None
                net = frame.at["Net Income", col] if "Net Income" in frame.index else None
                op = frame.at["Operating Income", col] if "Operating Income" in frame.index else None
                ebitda = frame.at["EBITDA", col] if "EBITDA" in frame.index else None
                out.append(
                    {
                        "date": report_date,
                        "calendarYear": str(report_date)[:4],
                        "revenue": _to_float(rev),
                        "netIncome": _to_float(net),
                        "operatingIncome": _to_float(op),
                        "ebitda": _to_float(ebitda),
                        "eps": None,
                    }
                )
            return out

        return await asyncio.to_thread(_read)

    async def get_quarterly_financials(self, symbol: str, quarters: int = 12) -> list[QuarterlyFinancial]:
        clean = symbol.strip().upper()
        cache_key = cache.build_key("earnings_quarterly_financials", clean, {"quarters": quarters})
        cached = await cache.get(cache_key)
        if isinstance(cached, list):
            return [QuarterlyFinancial(**x) if isinstance(x, dict) else x for x in cached]

        rows = await self._quarterly_from_fmp(clean, max(quarters, 12))
        if not rows:
            rows = await self._quarterly_from_yfinance(clean)

        normalized: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            q_date = _parse_date(row.get("date") or row.get("fillingDate") or row.get("acceptedDate"))
            if not q_date:
                continue
            normalized.append(
                {
                    "date": q_date,
                    "revenue": _to_float(row.get("revenue") or row.get("totalRevenue")),
                    "net_income": _to_float(row.get("netIncome")),
                    "operating_income": _to_float(row.get("operatingIncome")),
                    "ebitda": _to_float(row.get("ebitda")),
                    "eps": _to_float(row.get("eps") or row.get("epsdiluted") or row.get("epsDiluted")),
                }
            )

        normalized.sort(key=lambda x: x["date"])
        result: list[QuarterlyFinancial] = []
        for idx, row in enumerate(normalized):
            q_date: date = row["date"]
            rev = row.get("revenue")
            net = row.get("net_income")
            op = row.get("operating_income")
            ebitda = row.get("ebitda")
            eps = row.get("eps")

            prev = normalized[idx - 1] if idx - 1 >= 0 else None
            yoy = normalized[idx - 4] if idx - 4 >= 0 else None
            fy, q, qlabel = _fy_quarter(q_date)

            rev_qoq = _pct_change(rev, prev.get("revenue") if prev else None)
            rev_yoy = _pct_change(rev, yoy.get("revenue") if yoy else None)
            np_qoq = _pct_change(net, prev.get("net_income") if prev else None)
            np_yoy = _pct_change(net, yoy.get("net_income") if yoy else None)
            eps_qoq = _pct_change(eps, prev.get("eps") if prev else None)
            eps_yoy = _pct_change(eps, yoy.get("eps") if yoy else None)

            op_margin = None if op is None or rev in (None, 0) else (op / rev) * 100.0
            net_margin = None if net is None or rev in (None, 0) else (net / rev) * 100.0

            result.append(
                QuarterlyFinancial(
                    symbol=clean,
                    quarter=qlabel,
                    quarter_end_date=q_date,
                    revenue=rev or 0.0,
                    revenue_qoq_pct=rev_qoq,
                    revenue_yoy_pct=rev_yoy,
                    net_profit=net or 0.0,
                    net_profit_qoq_pct=np_qoq,
                    net_profit_yoy_pct=np_yoy,
                    operating_profit=op,
                    operating_margin_pct=op_margin,
                    net_margin_pct=net_margin,
                    ebitda=ebitda,
                    eps=eps,
                    eps_qoq_pct=eps_qoq,
                    eps_yoy_pct=eps_yoy,
                )
            )

        result = result[-max(1, quarters) :]
        await cache.set(cache_key, [x.model_dump() for x in result], ttl=self.FINANCIALS_TTL_SECONDS)
        return result

    async def get_earnings_analysis(self, symbol: str) -> EarningsAnalysis:
        clean = symbol.strip().upper()
        cache_key = cache.build_key("earnings_analysis", clean, {})
        cached = await cache.get(cache_key)
        if isinstance(cached, dict):
            return EarningsAnalysis(**cached)

        today = date.today()
        calendar = await self.get_earnings_calendar(
            from_date=today - timedelta(days=365),
            to_date=today + timedelta(days=365),
            symbols=[clean],
        )
        next_evt = next((x for x in calendar if x.earnings_date >= today), None)
        last_evt = next((x for x in reversed(calendar) if x.earnings_date <= today), None)

        financials = await self.get_quarterly_financials(clean, quarters=12)
        rev_trend = _trend_from_yoy([x.revenue_yoy_pct for x in financials])
        profit_trend = _trend_from_yoy([x.net_profit_yoy_pct for x in financials])

        historical_calendar = [x for x in calendar if x.earnings_date <= today]
        historical_calendar.sort(key=lambda x: x.earnings_date, reverse=True)
        consecutive_beats = 0
        for row in historical_calendar:
            if row.eps_surprise_pct is not None and row.eps_surprise_pct > 0:
                consecutive_beats += 1
            else:
                break
        last4 = [x.eps_surprise_pct for x in historical_calendar[:4] if x.eps_surprise_pct is not None]
        avg_surprise = sum(last4) / len(last4) if last4 else 0.0

        analysis = EarningsAnalysis(
            symbol=clean,
            company_name=next_evt.company_name if next_evt else (last_evt.company_name if last_evt else clean),
            next_earnings_date=next_evt,
            last_earnings=last_evt,
            quarterly_financials=financials,
            revenue_trend=rev_trend,
            profit_trend=profit_trend,
            consecutive_beats=consecutive_beats,
            avg_eps_surprise_pct=avg_surprise,
        )
        await cache.set(cache_key, analysis.model_dump(), ttl=self.ANALYSIS_TTL_SECONDS)
        return analysis

    async def get_portfolio_earnings(self, symbols: list[str], days_ahead: int = 30) -> list[EarningsDate]:
        clean = [x.strip().upper() for x in symbols if x and x.strip()]
        if not clean:
            return []
        sem = asyncio.Semaphore(5)
        today = date.today()
        end = today + timedelta(days=max(1, days_ahead))

        async def _one(sym: str) -> Optional[EarningsDate]:
            async with sem:
                return await self.get_next_earnings(sym)

        rows = await asyncio.gather(*(_one(sym) for sym in clean), return_exceptions=True)
        out: list[EarningsDate] = []
        for row in rows:
            if isinstance(row, Exception) or row is None:
                continue
            if today <= row.earnings_date <= end:
                out.append(row)
        out.sort(key=lambda x: x.earnings_date)
        return out


earnings_service = EarningsService()
