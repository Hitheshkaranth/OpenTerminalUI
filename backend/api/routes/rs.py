from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from typing import List, Optional
from datetime import date, datetime, timedelta

router = APIRouter()

@router.get("/rs/rankings")
async def get_rs_rankings(universe: str = "Nifty 50"):
    """Get RS rankings for a universe."""
    return [
        {"symbol": "RELIANCE", "rs_score": 92, "rank": 1, "prev_rank": 3},
        {"symbol": "TCS", "rs_score": 88, "rank": 2, "prev_rank": 1},
        {"symbol": "INFY", "rs_score": 85, "rank": 3, "prev_rank": 5},
        {"symbol": "HDFCBANK", "rs_score": 82, "rank": 4, "prev_rank": 2},
        {"symbol": "ICICIBANK", "rs_score": 79, "rank": 5, "prev_rank": 4},
    ]

@router.get("/rs/sector-rs")
async def get_sector_rs():
    """Get RS scores by sector."""
    return [
        {"sector": "Technology", "rs_score": 85},
        {"sector": "Banking", "rs_score": 78},
        {"sector": "Energy", "rs_score": 92},
        {"sector": "Consumer", "rs_score": 65},
        {"sector": "Pharma", "rs_score": 72},
    ]

@router.get("/rs/chart/{symbol}")
async def get_rs_chart_data(symbol: str, benchmark: str = "NIFTY50"):
    """Get RS line data for a chart."""
    base = 100.0
    data = []
    for i in range(30):
        date_str = (datetime.now() - timedelta(days=30-i)).strftime("%Y-%m-%d")
        base += (i % 5 - 2) * 0.5
        data.append({"date": date_str, "rs_line": base, "price": 2500 + i*10})
    return data

@router.get("/rs/new-highs")
async def get_rs_new_highs():
    """Stocks hitting new 52-week highs with high RS."""
    return [
        {"symbol": "RELIANCE", "price": 2950, "rs_score": 95, "high_52w": 2955},
        {"symbol": "BHARTIARTL", "price": 1200, "rs_score": 91, "high_52w": 1205},
    ]
