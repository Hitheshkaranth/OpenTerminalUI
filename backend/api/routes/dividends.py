from __future__ import annotations

import asyncio
import re
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.db.models import Holding
from backend.equity.services.corporate_actions import CorporateEvent, EventType, corporate_actions_service

router = APIRouter()

# Default scan universe for the market-wide calendar / aristocrats views (large-cap NSE names).
_NSE_UNIVERSE: tuple[str, ...] = (
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL",
    "KOTAKBANK", "LT", "AXISBANK", "ASIANPAINT", "MARUTI", "SUNPHARMA", "TITAN", "NESTLEIND",
    "ULTRACEMCO", "WIPRO", "HCLTECH", "POWERGRID", "NTPC", "ONGC", "COALINDIA", "BAJAJ-AUTO",
)
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _amount(event: CorporateEvent) -> float | None:
    """Per-share dividend from the filing text (e.g. 'INR 10', 'Rs 5.50 per share')."""
    for text in (event.value, event.title, event.description):
        match = re.search(r"(\d+(?:\.\d+)?)", str(text or "").replace(",", ""))
        if match:
            return float(match.group(1))
    return None


def _ex_date(event: CorporateEvent) -> date:
    return event.ex_date or event.event_date


@router.get("/dividends/calendar")
async def get_dividend_calendar(
    start: Optional[date] = None,
    end: Optional[date] = None,
    market: str = "NSE",
    symbols: Optional[str] = None,
):
    """Upcoming dividend ex-dates from real corporate-action filings, restricted to [start, end]."""
    today = date.today()
    window_start = start or today
    window_end = end or (window_start + timedelta(days=30))
    universe = [s.strip().upper() for s in symbols.split(",") if s.strip()] if symbols else list(_NSE_UNIVERSE)
    days_ahead = max(1, (window_end - today).days)
    events = await corporate_actions_service.get_portfolio_events(universe, days_ahead=days_ahead)
    rows: list[dict[str, Any]] = []
    for event in events:
        if event.event_type != EventType.DIVIDEND:
            continue
        ex = _ex_date(event)
        if not (window_start <= ex <= window_end):
            continue
        rows.append({
            "symbol": event.symbol,
            "ex_date": ex.isoformat(),
            "amount": _amount(event),
            "type": event.title or "Dividend",
            "source": event.source,
        })
    rows.sort(key=lambda r: (r["ex_date"], r["symbol"]))
    return rows


@router.get("/dividends/history/{symbol}")
async def get_dividend_history(symbol: str):
    """Historical dividends for a symbol from real corporate-action filings (oldest first)."""
    events = await corporate_actions_service.get_dividend_history(symbol.strip().upper())
    today = date.today()
    rows = [
        {"date": _ex_date(e).isoformat(), "amount": _amount(e)}
        for e in events
        if _ex_date(e) <= today and _amount(e) is not None
    ]
    rows.sort(key=lambda r: r["date"])
    return rows


def _consecutive_growth_years(history: list[dict[str, Any]]) -> int:
    per_year: dict[int, float] = {}
    for row in history:
        year = int(str(row["date"])[:4])
        per_year[year] = per_year.get(year, 0.0) + float(row["amount"] or 0.0)
    last_full_year = date.today().year - 1
    years = sorted(y for y in per_year if y <= last_full_year)
    streak = 0
    for prev, cur in zip(reversed(years[:-1]), reversed(years[1:])):
        if cur - prev != 1 or per_year[cur] <= per_year[prev]:
            break
        streak += 1
    return streak


@router.get("/dividends/aristocrats")
async def get_dividend_aristocrats(market: str = "NSE", min_years: int = 3):
    """Stocks with consecutive years of dividend growth, computed from real dividend history."""
    sem = asyncio.Semaphore(5)

    async def _one(sym: str) -> dict[str, Any] | None:
        async with sem:
            try:
                history = await get_dividend_history(sym)
            except Exception:
                return None
        streak = _consecutive_growth_years(history)
        if streak < min_years:
            return None
        return {"symbol": sym, "years_growth": streak, "yield": None}

    results = await asyncio.gather(*(_one(s) for s in _NSE_UNIVERSE))
    rows = [r for r in results if r]
    rows.sort(key=lambda r: (-r["years_growth"], r["symbol"]))
    return rows


@router.get("/dividends/portfolio-income")
async def get_portfolio_dividend_income(db: Session = Depends(get_db)):
    """Projected dividend income for the stored portfolio holdings (announced dividends x quantity)."""
    from backend.services.portfolio_analytics import portfolio_analytics_service

    holdings = db.query(Holding).all()
    if not holdings:
        return {"annual_income": None, "monthly_breakdown": [], "holdings_count": 0}
    tracker = await portfolio_analytics_service.dividend_tracker(holdings, days=365)
    monthly = {m: 0.0 for m in _MONTHS}
    for row in tracker.get("upcoming") or []:
        when = row.get("payment_date") or row.get("ex_date") or row.get("event_date")
        if isinstance(when, date):
            monthly[_MONTHS[when.month - 1]] += float(row.get("projected_income") or 0.0)
    return {
        "annual_income": round(float(tracker.get("annual_income_projection") or 0.0), 2),
        "monthly_breakdown": [{"month": m, "amount": round(v, 2)} for m, v in monthly.items()],
        "holdings_count": len(holdings),
    }
