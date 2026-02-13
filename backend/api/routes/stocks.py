from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import cache_instance, fetch_stock_snapshot_coalesced, get_unified_fetcher
from backend.core.models import StockSnapshot

router = APIRouter()

# --- Helpers to process 10y financials into frontend format ---
def _process_timeseries(data: Dict[str, Any], metric_map: Dict[str, str]) -> List[Dict[str, Any]]:
    # data is like { "annualTotalRevenue": { "timestamp": [...], "value": [...] } }
    # we need [{ "metric": "revenue", "2023-03-31": 100, ... }]
    
    if not data:
        return []

    # 1. Collect all dates
    all_dates = set()
    for mod in metric_map.keys():
        if mod in data:
            ts = data[mod].get("timestamp") or []
            for t in ts:
                # Yahoo timestamps are often unix epoch or strings?
                # YahooClient returns raw from API. Usually formatted as strings in response?
                # Actually my YahooClient.get_fundamentals_timeseries returns what API returns.
                # Yahoo timeseries API returns "asOfDate" usually in meta or just "timestamp" list.
                # Let's assume standard Yahoo format handling for dates.
                all_dates.add(str(t)) 
    
    sorted_dates = sorted(list(all_dates), reverse=True)
    
    results = []
    for mod, display_name in metric_map.items():
        if mod not in data:
            continue
            
        series = data[mod]
        timestamps = series.get("timestamp") or []
        values = series.get("value") or []
        
        row = {"metric": display_name}
        has_val = False
        
        # Create map for this metric
        t_v_map = {}
        for t, v in zip(timestamps, values):
            t_v_map[str(t)] = v
            
        for d in sorted_dates:
            val = t_v_map.get(d)
            if val is not None:
                row[d] = val
                has_val = True
                
        if has_val:
            results.append(row)
            
    return results

def _process_fmp_list(data: List[Dict[str, Any]], field_map: Dict[str, str]) -> List[Dict[str, Any]]:
    if not data:
        return []
        
    results = []
    for fmp_field, display_name in field_map.items():
        row = {"metric": display_name}
        has_val = False
        for item in data:
            date = item.get("date") or item.get("calendarYear")  # Accessing year/date
            val = item.get(fmp_field)
            if date and val is not None:
                row[str(date)] = val
                has_val = True
        if has_val:
            results.append(row)
            
    return results

@router.get("/stocks/{ticker}", response_model=StockSnapshot)
async def get_stock(ticker: str) -> StockSnapshot:
    try:
        snap = await fetch_stock_snapshot_coalesced(ticker)
    except Exception as exc:
        snap = {}
        # In case of total failure
    
    # Map UnifiedFetcher snapshot dict to StockSnapshot model
    return StockSnapshot(
        ticker=ticker.upper(),
        symbol=f"{ticker.upper()}.NS",
        company_name=snap.get("company_name"),
        sector=snap.get("sector"),
        industry=snap.get("industry") or snap.get("sector"),
        current_price=snap.get("current_price"),
        change_pct=snap.get("change_pct"),
        market_cap=snap.get("market_cap"),
        enterprise_value=snap.get("enterprise_value"),
        pe=snap.get("pe"),
        forward_pe_calc=snap.get("forward_pe"),
        pb_calc=snap.get("pb"),
        ps_calc=snap.get("ps"),
        ev_ebitda=snap.get("ev_ebitda"),
        roe_pct=snap.get("roe_pct"),
        roa_pct=snap.get("roa_pct"),
        op_margin_pct=snap.get("op_margin_pct"),
        net_margin_pct=snap.get("net_margin_pct"),
        rev_growth_pct=snap.get("rev_growth_pct"),
        eps_growth_pct=snap.get("eps_growth_pct"),
        div_yield_pct=snap.get("div_yield_pct"),
        beta=snap.get("beta"),
        raw=snap,
    )

def _yahoo_ts_to_table(yahoo_data: Dict, prefix: str, field_map: Dict[str, str]) -> List[Dict[str, Any]]:
    """Convert Yahoo timeseries to frontend table rows [{metric, date1, date2, ...}]."""
    # Collect all dates across all fields
    all_dates: set[str] = set()
    field_series: Dict[str, Dict[str, float]] = {}
    for yahoo_suffix, display_name in field_map.items():
        full_key = f"{prefix}{yahoo_suffix}"
        series = yahoo_data.get(full_key, {})
        values = series.get("value") or []
        date_val: Dict[str, float] = {}
        for item in values:
            if not isinstance(item, dict):
                continue
            date = item.get("asOfDate") or ""
            rv = item.get("reportedValue")
            val = rv.get("raw") if isinstance(rv, dict) else rv
            if date and val is not None:
                date_val[date] = val
                all_dates.add(date)
        if date_val:
            field_series[display_name] = date_val

    sorted_dates = sorted(all_dates, reverse=True)
    rows = []
    for display_name, date_val in field_series.items():
        row: Dict[str, Any] = {"metric": display_name}
        for d in sorted_dates:
            if d in date_val:
                row[d] = date_val[d]
        rows.append(row)
    return rows


_Y_INC_TABLE = {
    "TotalRevenue": "Revenue", "CostOfRevenue": "Cost of Revenue",
    "GrossProfit": "Gross Profit", "OperatingIncome": "Operating Income",
    "NetIncome": "Net Income", "DilutedEPS": "EPS", "Ebitda": "EBITDA",
}
_Y_BAL_TABLE = {
    "TotalAssets": "Total Assets",
    "TotalLiabilitiesNetMinorityInterest": "Total Liabilities",
    "StockholdersEquity": "Total Equity",
    "TotalDebt": "Total Debt",
}
_Y_CF_TABLE = {
    "OperatingCashFlow": "Operating Cash Flow", "CapitalExpenditure": "Capex",
    "FreeCashFlow": "Free Cash Flow",
}
_FMP_INC_MAP = {
    "revenue": "Revenue", "costOfRevenue": "Cost of Revenue",
    "grossProfit": "Gross Profit", "operatingIncome": "Operating Income",
    "netIncome": "Net Income", "eps": "EPS", "ebitda": "EBITDA",
}
_FMP_BAL_MAP = {
    "totalAssets": "Total Assets", "totalLiabilities": "Total Liabilities",
    "totalStockholdersEquity": "Total Equity",
    "cashAndCashEquivalents": "Cash & Equivalents", "totalDebt": "Total Debt",
}
_FMP_CF_MAP = {
    "operatingCashFlow": "Operating Cash Flow", "capitalExpenditure": "Capex",
    "freeCashFlow": "Free Cash Flow", "dividendsPaid": "Dividends Paid",
}


@router.get("/stocks/{ticker}/financials")
async def get_financials(ticker: str, period: str = Query(default="annual", pattern="^(annual|quarterly)$")) -> Dict[str, Any]:
    fetcher = await get_unified_fetcher()
    finance_data = await fetcher.fetch_10yr_financials(ticker)

    yahoo_data = finance_data.get("yahoo_fundamentals", {})
    fmp_inc = finance_data.get("fmp_income", [])
    fmp_bal = finance_data.get("fmp_balance", [])
    fmp_cf = finance_data.get("fmp_cashflow", [])

    prefix = "quarterly" if period == "quarterly" else "annual"

    # Prefer Yahoo timeseries (up to 10+ years), fall back to FMP
    income = _yahoo_ts_to_table(yahoo_data, prefix, _Y_INC_TABLE)
    if not income:
        income = _process_fmp_list(fmp_inc, _FMP_INC_MAP)

    balance = _yahoo_ts_to_table(yahoo_data, prefix, _Y_BAL_TABLE)
    if not balance:
        balance = _process_fmp_list(fmp_bal, _FMP_BAL_MAP)

    cashflow = _yahoo_ts_to_table(yahoo_data, prefix, _Y_CF_TABLE)
    if not cashflow:
        cashflow = _process_fmp_list(fmp_cf, _FMP_CF_MAP)

    return {
        "ticker": ticker.upper(),
        "period": period,
        "income_statement": income,
        "balance_sheet": balance,
        "cashflow": cashflow,
    }

@router.get("/stocks")
async def get_stocks(tickers: str) -> List[Dict[str, Any]]:
    names = [x.strip().upper() for x in tickers.split(",") if x.strip()]
    
    async def _fetch_one(t: str):
        try:
            s = await fetch_stock_snapshot_coalesced(t)
            return {
                "ticker": t,
                "company_name": s.get("company_name"),
                "current_price": s.get("current_price"),
                "market_cap": s.get("market_cap"),
                "pe": s.get("pe"),
                "change_pct": s.get("change_pct"),
            }
        except:
            return {"ticker": t, "error": "Fetch failed"}
            
    return await asyncio.gather(*(_fetch_one(t) for t in names))

@router.get("/stocks/{ticker}/returns")
async def get_returns(ticker: str) -> Dict[str, Optional[float]]:
    fetcher = await get_unified_fetcher()
    # Priority matrix says NSE -> Yahoo. `fetch_history` implements this.
    try:
        # We need long history for returns (5y)
        # Yahoo is best for this.
        data = await fetcher.yahoo.get_chart(f"{ticker.upper()}.NS", range_str="5y", interval="1d")
        
        # Parse Yahoo chart
        chart = (data.get("chart") or {}).get("result") or []
        if not chart:
            return {}
            
        timestamps = chart[0].get("timestamp", [])
        indicators = chart[0].get("indicators", {}).get("quote", [{}])[0]
        closes = indicators.get("close", [])
        
        if not closes:
            return {}
            
        # Create Series-like structure
        # Filter None
        valid = [(t, c) for t, c in zip(timestamps, closes) if c is not None]
        if not valid:
            return {}
            
        # Sort by time
        valid.sort(key=lambda x: x[0])
        vals = [v[1] for v in valid]
        
        # Helper for return calc
        def _calc_ret(days_lookback):
            if len(vals) < days_lookback + 1:
                return None
            curr = vals[-1]
            prev = vals[-(days_lookback + 1)]
            if prev == 0: return 0.0
            return ((curr - prev) / prev) * 100.0
            
        # Approximation: 252 trading days = 1y
        return {
            "1m": _calc_ret(21),
            "3m": _calc_ret(63),
            "6m": _calc_ret(126),
            "1y": _calc_ret(252),
            "3y": _calc_ret(756),
            "5y": _calc_ret(1260)
        }
    except Exception:
        return {}
