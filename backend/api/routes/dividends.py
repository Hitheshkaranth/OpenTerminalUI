from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from typing import List, Optional
from datetime import date, datetime, timedelta

from backend.api.deps import get_unified_fetcher

router = APIRouter()

@router.get("/dividends/calendar")
async def get_dividend_calendar(
    start: Optional[date] = None,
    end: Optional[date] = None,
    market: str = "NSE"
):
    """Get upcoming dividend events."""
    return [
        {"symbol": "RELIANCE", "ex_date": "2026-04-15", "amount": 10.0, "type": "Final"},
        {"symbol": "TCS", "ex_date": "2026-04-20", "amount": 28.0, "type": "Interim"},
        {"symbol": "INFY", "ex_date": "2026-04-22", "amount": 17.5, "type": "Special"},
    ]

@router.get("/dividends/history/{symbol}")
async def get_dividend_history(symbol: str):
    """Get historical dividends for a symbol."""
    return [
        {"date": "2025-08-10", "amount": 9.0},
        {"date": "2024-08-12", "amount": 8.5},
        {"date": "2023-08-14", "amount": 7.0},
        {"date": "2022-08-16", "amount": 6.5},
    ]

@router.get("/dividends/aristocrats")
async def get_dividend_aristocrats(market: str = "NSE"):
    """Get stocks with long history of dividend growth."""
    return [
        {"symbol": "HDFCBANK", "years_growth": 25, "yield": 1.2},
        {"symbol": "ITC", "years_growth": 20, "yield": 3.5},
        {"symbol": "NESTLEIND", "years_growth": 18, "yield": 0.8},
    ]

@router.get("/dividends/portfolio-income")
async def get_portfolio_dividend_income():
    """Projected dividend income for current portfolio."""
    return {
        "annual_income": 45200.0,
        "monthly_breakdown": [
            {"month": "Jan", "amount": 2000},
            {"month": "Feb", "amount": 1500},
            {"month": "Mar", "amount": 8000},
            {"month": "Apr", "amount": 12000},
            {"month": "May", "amount": 3000},
            {"month": "Jun", "amount": 1000},
            {"month": "Jul", "amount": 4000},
            {"month": "Aug", "amount": 9000},
            {"month": "Sep", "amount": 1000},
            {"month": "Oct", "amount": 1500},
            {"month": "Nov", "amount": 1200},
            {"month": "Dec", "amount": 1000},
        ]
    }
