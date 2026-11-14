from __future__ import annotations

from typing import Any, List, Optional
from fastapi import APIRouter, HTTPException, Query
from backend.api.deps import get_unified_fetcher
from backend.core.models import (
    ETFScreenerResponse,
    ETFHoldingsResponse,
    ETFHolding,
    ETFOverlapResponse,
    ETFFlowResponse,
    ETFFlowPoint
)

router = APIRouter(prefix="/etf", tags=["etf"])

@router.get("/screener", response_model=List[ETFScreenerResponse])
async def etf_screener(category: Optional[str] = None):
    # Mock data for popular ETFs for now
    # In a real app, this would query a database or a specialized ETF provider
    popular_etfs = [
        {"ticker": "SPY", "name": "SPDR S&P 500 ETF Trust", "exchange": "NYSE Arca", "category": "Large Blend", "expense_ratio": 0.09, "aum": 500000000000, "ytd_return": 10.5, "three_year_return": 12.2},
        {"ticker": "QQQ", "name": "Invesco QQQ Trust", "exchange": "NASDAQ", "category": "Large Growth", "expense_ratio": 0.20, "aum": 250000000000, "ytd_return": 15.2, "three_year_return": 14.5},
        {"ticker": "VTI", "name": "Vanguard Total Stock Market ETF", "exchange": "NYSE Arca", "category": "Large Blend", "expense_ratio": 0.03, "aum": 350000000000, "ytd_return": 9.8, "three_year_return": 11.8},
        {"ticker": "IWM", "name": "iShares Russell 2000 ETF", "exchange": "NYSE Arca", "category": "Small Blend", "expense_ratio": 0.19, "aum": 60000000000, "ytd_return": 2.5, "three_year_return": 5.2},
        {"ticker": "EEM", "name": "iShares MSCI Emerging Markets ETF", "exchange": "NYSE Arca", "category": "Emerging Markets", "expense_ratio": 0.70, "aum": 25000000000, "ytd_return": 1.2, "three_year_return": -2.5},
        {"ticker": "NIFTYBEES.NS", "name": "Nippon India ETF Nifty 50 BeES", "exchange": "NSE", "category": "Large Cap", "expense_ratio": 0.04, "aum": 20000000000, "ytd_return": 8.5, "three_year_return": 15.5},
        {"ticker": "JUNIORBEES.NS", "name": "Nippon India ETF Nifty Next 50 BeES", "exchange": "NSE", "category": "Next 50", "expense_ratio": 0.15, "aum": 5000000000, "ytd_return": 12.5, "three_year_return": 18.2},
    ]

    if category:
        return [e for e in popular_etfs if category.lower() in e["category"].lower()]
    return popular_etfs

@router.get("/holdings", response_model=ETFHoldingsResponse)
async def etf_holdings(ticker: str):
    fetcher = await get_unified_fetcher()
    # Yahoo modules for ETF: topHoldings
    try:
        summary = await fetcher.yahoo.get_quote_summary(ticker, modules=["topHoldings"])
        holdings_data = summary.get("topHoldings", {})
        holdings_list = holdings_data.get("holdings", [])

        result_holdings = []
        for h in holdings_list:
            result_holdings.append(ETFHolding(
                symbol=h.get("symbol", ""),
                name=h.get("holdingName", ""),
                weight=h.get("holdingPercent", {}).get("raw", 0.0) * 100 if isinstance(h.get("holdingPercent"), dict) else (h.get("holdingPercent", 0.0) * 100)
            ))

        return ETFHoldingsResponse(ticker=ticker.upper(), holdings=result_holdings)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Holdings provider is unavailable")

@router.get("/overlap", response_model=ETFOverlapResponse)
async def etf_overlap(tickers: str = Query(...)):
    ticker_list = [t.strip().upper() for t in tickers.split(",")]
    if len(ticker_list) < 2:
        raise HTTPException(status_code=400, detail="Provide at least two tickers for overlap analysis")

    fetcher = await get_unified_fetcher()

    all_holdings = {}
    for ticker in ticker_list:
        try:
            summary = await fetcher.yahoo.get_quote_summary(ticker, modules=["topHoldings"])
            holdings_data = summary.get("topHoldings", {})
            holdings_list = holdings_data.get("holdings", [])

            ticker_holdings = {}
            for h in holdings_list:
                symbol = h.get("symbol", "")
                if symbol:
                    ticker_holdings[symbol] = {
                        "name": h.get("holdingName", ""),
                        "weight": h.get("holdingPercent", {}).get("raw", 0.0) * 100 if isinstance(h.get("holdingPercent"), dict) else (h.get("holdingPercent", 0.0) * 100)
                    }
            all_holdings[ticker] = ticker_holdings
        except Exception:
            all_holdings[ticker] = {}

    if any(not all_holdings.get(ticker) for ticker in ticker_list[:2]):
        raise HTTPException(status_code=503, detail="Holdings are unavailable; overlap cannot be calculated")

    # Calculate overlap between the first two for now
    t1, t2 = ticker_list[0], ticker_list[1]
    h1, h2 = all_holdings.get(t1, {}), all_holdings.get(t2, {})

    common_symbols = set(h1.keys()) & set(h2.keys())
    common_holdings = []
    total_overlap = 0.0

    for symbol in common_symbols:
        w1 = h1[symbol]["weight"]
        w2 = h2[symbol]["weight"]
        # Overlap weight is the minimum of the two weights
        overlap_w = min(w1, w2)
        total_overlap += overlap_w
        common_holdings.append(ETFHolding(
            symbol=symbol,
            name=h1[symbol]["name"],
            weight=overlap_w
        ))

    # Sort by overlap weight
    common_holdings.sort(key=lambda x: x.weight, reverse=True)

    return ETFOverlapResponse(
        tickers=ticker_list,
        overlap_pct=total_overlap,
        common_holdings=common_holdings
    )

@router.get("/flows", response_model=ETFFlowResponse)
async def etf_flows(ticker: str):
    # There is no flow provider wired here. Missing observations must not be
    # replaced with randomly generated institutional activity.
    return ETFFlowResponse(ticker=ticker.upper(), flows=[])
