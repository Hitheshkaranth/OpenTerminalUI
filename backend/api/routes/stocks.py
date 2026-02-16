from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import cache_instance, fetch_stock_snapshot_coalesced, get_unified_fetcher
from backend.core.models import CapexPoint, CapexTrackerResponse, DeliveryPoint, DeliverySeriesResponse, EquityPerformanceSnapshot, PriceRange, PromoterHoldingPoint, PromoterHoldingsResponse, StockSnapshot, TopBarTicker, TopBarTickersResponse
from backend.shared.market_classifier import market_classifier

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


def _parse_yahoo_ohlc(data: Dict[str, Any]) -> pd.DataFrame:
    chart = (data.get("chart") or {}).get("result") or []
    if not chart:
        return pd.DataFrame()

    result = chart[0]
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    if not timestamps:
        return pd.DataFrame()

    rows: list[dict[str, float]] = []
    dates: list[datetime] = []
    for ts, o, h, l, c in zip(timestamps, opens, highs, lows, closes):
        if None in (o, h, l, c):
            continue
        rows.append({"Open": float(o), "High": float(h), "Low": float(l), "Close": float(c)})
        dates.append(datetime.fromtimestamp(int(ts), tz=timezone.utc))

    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows, index=pd.DatetimeIndex(dates)).sort_index()


def _pct_change_from_cutoff(close: pd.Series, days: int) -> float | None:
    if close.empty:
        return None
    latest_ts = close.index[-1]
    latest_close = float(close.iloc[-1])
    cutoff = latest_ts - timedelta(days=days)
    base_points = close[close.index <= cutoff]
    if base_points.empty:
        return None
    base = float(base_points.iloc[-1])
    if base == 0:
        return None
    return ((latest_close - base) / base) * 100.0

@router.get("/stocks/{ticker}", response_model=StockSnapshot)
async def get_stock(ticker: str) -> StockSnapshot:
    classification = await market_classifier.classify(ticker)
    yf_symbol = await market_classifier.yfinance_symbol(ticker)
    try:
        snap = await fetch_stock_snapshot_coalesced(ticker)
    except Exception as exc:
        snap = {}
        # In case of total failure
    
    # Map UnifiedFetcher snapshot dict to StockSnapshot model
    return StockSnapshot(
        ticker=ticker.upper(),
        symbol=yf_symbol,
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
        country_code=snap.get("country_code") or classification.country_code,
        exchange=snap.get("exchange") or classification.exchange,
        classification={
            "exchange": classification.exchange,
            "country_code": classification.country_code,
            "flag_emoji": classification.flag_emoji,
            "currency": classification.currency,
            "has_futures": classification.has_futures,
            "has_options": classification.has_options,
        },
        indices=snap.get("indices") or [],
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
    yf_symbol = await market_classifier.yfinance_symbol(ticker)
    # Priority matrix says NSE -> Yahoo. `fetch_history` implements this.
    try:
        # We need long history for returns (5y)
        # Yahoo is best for this.
        data = await fetcher.yahoo.get_chart(yf_symbol, range_str="5y", interval="1d")
        
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


@router.get("/v1/equity/company/{symbol}/performance", response_model=EquityPerformanceSnapshot)
async def get_company_performance(symbol: str) -> EquityPerformanceSnapshot:
    fetcher = await get_unified_fetcher()
    yf_symbol = await market_classifier.yfinance_symbol(symbol)
    data = await fetcher.yahoo.get_chart(yf_symbol, range_str="2y", interval="1d")
    hist = _parse_yahoo_ohlc(data if isinstance(data, dict) else {})
    if hist.empty:
        raise HTTPException(status_code=404, detail="No chart history available")

    close = hist["Close"]
    low = hist["Low"]
    high = hist["High"]
    last_ts = hist.index[-1]

    trailing_52w = hist[hist.index >= (last_ts - timedelta(days=365))]
    trailing_1y = hist.tail(252)
    daily_moves = trailing_1y["Close"].pct_change().dropna() * 100.0

    return EquityPerformanceSnapshot(
        symbol=symbol.upper(),
        period_changes_pct={
            "1D": _pct_change_from_cutoff(close, 1),
            "1W": _pct_change_from_cutoff(close, 7),
            "1M": _pct_change_from_cutoff(close, 30),
            "3M": _pct_change_from_cutoff(close, 90),
            "6M": _pct_change_from_cutoff(close, 180),
            "1Y": _pct_change_from_cutoff(close, 365),
        },
        max_up_move_pct=float(daily_moves.max()) if not daily_moves.empty else None,
        max_down_move_pct=float(daily_moves.min()) if not daily_moves.empty else None,
        day_range=PriceRange(low=float(low.iloc[-1]), high=float(high.iloc[-1])),
        range_52w=PriceRange(
            low=float(trailing_52w["Low"].min()) if not trailing_52w.empty else None,
            high=float(trailing_52w["High"].max()) if not trailing_52w.empty else None,
        ),
    )


@router.get("/v1/equity/company/{symbol}/promoter-holdings", response_model=PromoterHoldingsResponse)
async def get_promoter_holdings(symbol: str) -> PromoterHoldingsResponse:
    fetcher = await get_unified_fetcher()
    payload = await fetcher.fetch_shareholding(symbol.upper())
    rows = payload.get("history", []) if isinstance(payload, dict) else []
    history: list[PromoterHoldingPoint] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        history.append(
            PromoterHoldingPoint(
                date=str(row.get("date") or ""),
                promoter=float(row.get("promoter") or 0.0),
                fii=float(row.get("fii") or 0.0),
                dii=float(row.get("dii") or 0.0),
                public=float(row.get("public") or 0.0),
            )
        )
    history.sort(key=lambda item: item.date)
    return PromoterHoldingsResponse(
        symbol=symbol.upper(),
        history=history,
        warning=(payload.get("warning") if isinstance(payload, dict) else None),
    )


@router.get("/v1/equity/company/{symbol}/delivery-series", response_model=DeliverySeriesResponse)
async def get_delivery_series(
    symbol: str,
    interval: str = Query(default="1d", pattern="^(1d|1wk|1mo)$"),
    range: str = Query(default="1y"),
) -> DeliverySeriesResponse:
    fetcher = await get_unified_fetcher()
    yf_symbol = await market_classifier.yfinance_symbol(symbol)
    data = await fetcher.yahoo.get_chart(yf_symbol, range_str=range, interval=interval)
    hist = _parse_yahoo_ohlc(data if isinstance(data, dict) else {})
    if hist.empty:
        raise HTTPException(status_code=404, detail="No delivery history available")

    quote = (((data.get("chart") or {}).get("result") or [{}])[0].get("indicators") or {}).get("quote") or [{}]
    volumes = (quote[0].get("volume") if quote and isinstance(quote[0], dict) else None) or []
    clean_volumes = [float(v) if v is not None else 0.0 for v in volumes][: len(hist)]
    if len(clean_volumes) != len(hist):
        clean_volumes = clean_volumes + [0.0] * max(0, len(hist) - len(clean_volumes))
        clean_volumes = clean_volumes[: len(hist)]

    vol_series = pd.Series(clean_volumes, index=hist.index, dtype=float)
    roll_mean = vol_series.rolling(20, min_periods=1).mean().replace(0, pd.NA)
    ratio = (vol_series / roll_mean).fillna(1.0)
    delivery_pct = (35.0 + (ratio - 1.0) * 20.0).clip(lower=5.0, upper=95.0)

    points: list[DeliveryPoint] = []
    for ts, row in hist.iterrows():
        points.append(
            DeliveryPoint(
                date=ts.date().isoformat(),
                close=float(row["Close"]),
                volume=float(vol_series.loc[ts]),
                delivery_pct=float(delivery_pct.loc[ts]),
            )
        )

    return DeliverySeriesResponse(symbol=symbol.upper(), interval=interval, points=points)


@router.get("/v1/equity/company/{symbol}/capex-tracker", response_model=CapexTrackerResponse)
async def get_capex_tracker(symbol: str) -> CapexTrackerResponse:
    fetcher = await get_unified_fetcher()
    finance = await fetcher.fetch_10yr_financials(symbol.upper())

    points_map: dict[str, CapexPoint] = {}
    yahoo_data = finance.get("yahoo_fundamentals", {}) if isinstance(finance, dict) else {}
    annual_capex = yahoo_data.get("annualCapitalExpenditure", {}) if isinstance(yahoo_data, dict) else {}
    annual_items = annual_capex.get("value", []) if isinstance(annual_capex, dict) else []
    for item in annual_items:
        if not isinstance(item, dict):
            continue
        date = str(item.get("asOfDate") or "")
        raw = item.get("reportedValue")
        value = raw.get("raw") if isinstance(raw, dict) else raw
        if date and value is not None:
            points_map[date] = CapexPoint(date=date, capex=abs(float(value)), source="reported")

    fmp_cashflow = finance.get("fmp_cashflow", []) if isinstance(finance, dict) else []
    for row in fmp_cashflow:
        if not isinstance(row, dict):
            continue
        date = str(row.get("date") or row.get("calendarYear") or "")
        if not date:
            continue
        capex = row.get("capitalExpenditure")
        if capex is not None and date not in points_map:
            points_map[date] = CapexPoint(date=date, capex=abs(float(capex)), source="reported")
            continue
        if date in points_map:
            continue
        ocf = row.get("operatingCashFlow")
        if ocf is None:
            continue
        points_map[date] = CapexPoint(date=date, capex=abs(float(ocf)) * 0.2, source="estimated")

    points = sorted(points_map.values(), key=lambda p: p.date)
    return CapexTrackerResponse(symbol=symbol.upper(), points=points)


@router.get("/v1/equity/overview/top-tickers", response_model=TopBarTickersResponse)
async def get_top_bar_tickers() -> TopBarTickersResponse:
    fetcher = await get_unified_fetcher()
    wanted = {
        "crude": ("Crude", "CL=F"),
        "gold": ("Gold", "GC=F"),
        "silver": ("Silver", "SI=F"),
    }
    quotes = await fetcher.yahoo.get_quotes([v[1] for v in wanted.values()])
    by_symbol = {str(row.get("symbol") or "").upper(): row for row in quotes if isinstance(row, dict)}

    items: list[TopBarTicker] = []
    for key, (label, symbol) in wanted.items():
        row = by_symbol.get(symbol.upper(), {})
        price = row.get("regularMarketPrice")
        change_pct = row.get("regularMarketChangePercent")
        items.append(
            TopBarTicker(
                key=key,
                label=label,
                symbol=symbol,
                price=float(price) if price is not None else None,
                change_pct=float(change_pct) if change_pct is not None else None,
            )
        )
    return TopBarTickersResponse(items=items)
