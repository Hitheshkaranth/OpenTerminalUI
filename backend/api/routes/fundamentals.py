from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, HTTPException

from backend.api.deps import fetch_stock_snapshot_coalesced, get_unified_fetcher
from backend.core.fundamental_scores import (
    altman_z_score,
    cagr,
    cash_conversion_cycle,
    dvm_score,
    dupont_analysis,
    fcf_yield,
    graham_number,
    magic_formula_rank,
    peg_ratio,
    piotroski_f_score,
)

router = APIRouter()


@router.get("/stocks/{ticker}/snapshot-v2")
async def snapshot_v2(ticker: str) -> dict:
    if not ticker.strip():
        raise HTTPException(status_code=400, detail="Ticker is required")
    return await fetch_stock_snapshot_coalesced(ticker.strip().upper())


@router.get("/stocks/{ticker}/fundamentals/10yr")
async def fundamentals_10yr(ticker: str) -> dict:
    fetcher = await get_unified_fetcher()
    if not ticker.strip():
        raise HTTPException(status_code=400, detail="Ticker is required")
    return await fetcher.fetch_10yr_financials(ticker.strip().upper())


@router.get("/stocks/{ticker}/shareholding")
async def shareholding(ticker: str) -> dict:
    fetcher = await get_unified_fetcher()
    symbol = ticker.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="Ticker is required")
    try:
        return await fetcher.fetch_shareholding(symbol)
    except Exception as exc:
        return {
            "ticker": symbol,
            "history": [],
            "raw": {},
            "warning": f"Shareholding unavailable: {exc}",
        }


@router.get("/stocks/{ticker}/corporate-actions")
async def corporate_actions(ticker: str) -> dict:
    fetcher = await get_unified_fetcher()
    return await fetcher.fetch_corporate_actions(ticker.strip().upper())


@router.get("/stocks/{ticker}/analyst-consensus")
async def analyst_consensus(ticker: str) -> dict:
    fetcher = await get_unified_fetcher()
    return await fetcher.fetch_analyst_consensus(ticker.strip().upper())


def _to_float(value: Any) -> float | None:
    if value in (None, "", "-", "NA", "N/A"):
        return None
    try:
        out = float(value)
        if math.isnan(out) or math.isinf(out):
            return None
        return out
    except (TypeError, ValueError):
        return None


def _pick_float(row: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        if key in row:
            out = _to_float(row.get(key))
            if out is not None:
                return out
    return None


def _yahoo_ts_to_rows(yahoo_data: dict, prefix: str, field_map: dict[str, str]) -> list[dict[str, Any]]:
    """Convert Yahoo timeseries data to FMP-compatible rows sorted by date desc."""
    date_data: dict[str, dict[str, Any]] = {}
    for yahoo_suffix, fmp_key in field_map.items():
        full_key = f"{prefix}{yahoo_suffix}"
        series = yahoo_data.get(full_key, {})
        values = series.get("value") or []
        for item in values:
            if not isinstance(item, dict):
                continue
            date = item.get("asOfDate") or ""
            rv = item.get("reportedValue")
            val = rv.get("raw") if isinstance(rv, dict) else rv
            if date and val is not None:
                if date not in date_data:
                    date_data[date] = {"date": date}
                date_data[date][fmp_key] = val
    return sorted(date_data.values(), key=lambda x: x.get("date", ""), reverse=True)


_YAHOO_INCOME_MAP = {
    "TotalRevenue": "revenue", "CostOfRevenue": "costOfRevenue",
    "GrossProfit": "grossProfit", "OperatingIncome": "operatingIncome",
    "NetIncome": "netIncome", "DilutedEPS": "epsdiluted", "BasicEPS": "eps",
    "Ebitda": "ebitda", "DilutedAverageShares": "weightedAverageShsOutDil",
    "BasicAverageShares": "weightedAverageShsOut", "OperatingExpense": "operatingExpenses",
    "PretaxIncome": "incomeBeforeTax", "TaxProvision": "incomeTaxExpense",
}
_YAHOO_BALANCE_MAP = {
    "TotalAssets": "totalAssets",
    "TotalLiabilitiesNetMinorityInterest": "totalLiabilities",
    "StockholdersEquity": "totalStockholdersEquity",
    "TotalDebt": "totalDebt", "WorkingCapital": "workingCapital",
    "TangibleBookValue": "tangibleBookValue", "NetDebt": "netDebt",
    "ShareIssued": "commonStock",
    "TotalEquityGrossMinorityInterest": "retainedEarnings",
    "InvestedCapital": "investedCapital",
}
_YAHOO_CASHFLOW_MAP = {
    "FreeCashFlow": "freeCashFlow", "OperatingCashFlow": "operatingCashFlow",
    "CapitalExpenditure": "capitalExpenditure",
}


@router.get("/stocks/{ticker}/scores")
async def scores(ticker: str) -> dict[str, Any]:
    symbol = ticker.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="Ticker is required")

    snapshot = await fetch_stock_snapshot_coalesced(symbol)
    fetcher = await get_unified_fetcher()
    fin = await fetcher.fetch_10yr_financials(symbol)
    income_rows = fin.get("fmp_income") or []
    balance_rows = fin.get("fmp_balance") or []
    cash_rows = fin.get("fmp_cashflow") or []

    # If FMP returned nothing, fall back to Yahoo timeseries data
    yahoo_data = fin.get("yahoo_fundamentals") or {}
    if not income_rows and yahoo_data:
        income_rows = _yahoo_ts_to_rows(yahoo_data, "annual", _YAHOO_INCOME_MAP)
    if not balance_rows and yahoo_data:
        balance_rows = _yahoo_ts_to_rows(yahoo_data, "annual", _YAHOO_BALANCE_MAP)
    if not cash_rows and yahoo_data:
        cash_rows = _yahoo_ts_to_rows(yahoo_data, "annual", _YAHOO_CASHFLOW_MAP)

    latest_income = income_rows[0] if income_rows else {}
    prev_income = income_rows[1] if len(income_rows) > 1 else {}
    latest_balance = balance_rows[0] if balance_rows else {}
    prev_balance = balance_rows[1] if len(balance_rows) > 1 else {}
    latest_cash = cash_rows[0] if cash_rows else {}

    revenue = _pick_float(latest_income, ["revenue", "totalRevenue"])
    revenue_prev = _pick_float(prev_income, ["revenue", "totalRevenue"])
    net_income = _pick_float(latest_income, ["netIncome"])
    net_income_prev = _pick_float(prev_income, ["netIncome"])
    gross_profit = _pick_float(latest_income, ["grossProfit"])
    gross_profit_prev = _pick_float(prev_income, ["grossProfit"])
    operating_income = _pick_float(latest_income, ["operatingIncome", "ebit"])
    diluted_eps = _pick_float(latest_income, ["epsdiluted", "eps", "dilutedEPS"])

    total_assets = _pick_float(latest_balance, ["totalAssets"])
    total_assets_prev = _pick_float(prev_balance, ["totalAssets"])
    total_liabilities = _pick_float(latest_balance, ["totalLiabilities"])
    total_debt = _pick_float(latest_balance, ["totalDebt", "longTermDebt"])
    total_debt_prev = _pick_float(prev_balance, ["totalDebt", "longTermDebt"])
    current_assets = _pick_float(latest_balance, ["totalCurrentAssets"])
    current_assets_prev = _pick_float(prev_balance, ["totalCurrentAssets"])
    current_liabilities = _pick_float(latest_balance, ["totalCurrentLiabilities"])
    current_liabilities_prev = _pick_float(prev_balance, ["totalCurrentLiabilities"])
    stock_equity = _pick_float(latest_balance, ["totalStockholdersEquity"])
    retained_earnings = _pick_float(latest_balance, ["retainedEarnings"])
    receivables = _pick_float(latest_balance, ["netReceivables", "accountsReceivables"])
    inventory = _pick_float(latest_balance, ["inventory"])
    payables = _pick_float(latest_balance, ["accountPayables"])
    shares_out = _pick_float(latest_income, ["weightedAverageShsOutDil", "weightedAverageShsOut"])
    shares_out_prev = _pick_float(prev_income, ["weightedAverageShsOutDil", "weightedAverageShsOut"])

    operating_cash = _pick_float(latest_cash, ["operatingCashFlow", "netCashProvidedByOperatingActivities"])
    free_cash = _pick_float(latest_cash, ["freeCashFlow"])
    capex = _pick_float(latest_cash, ["capitalExpenditure"])
    if free_cash is None and operating_cash is not None and capex is not None:
        free_cash = operating_cash - capex

    roa = (net_income / total_assets) if net_income is not None and total_assets not in (None, 0) else None
    roa_prev = (net_income_prev / total_assets_prev) if net_income_prev is not None and total_assets_prev not in (None, 0) else None
    gross_margin = (gross_profit / revenue) if gross_profit is not None and revenue not in (None, 0) else None
    gross_margin_prev = (gross_profit_prev / revenue_prev) if gross_profit_prev is not None and revenue_prev not in (None, 0) else None
    asset_turnover = (revenue / total_assets) if revenue is not None and total_assets not in (None, 0) else None
    asset_turnover_prev = (revenue_prev / total_assets_prev) if revenue_prev is not None and total_assets_prev not in (None, 0) else None
    current_ratio = (current_assets / current_liabilities) if current_assets is not None and current_liabilities not in (None, 0) else None
    current_ratio_prev = (current_assets_prev / current_liabilities_prev) if current_assets_prev is not None and current_liabilities_prev not in (None, 0) else None

    piotroski_input = {
        "roa": roa,
        "roa_prev": roa_prev,
        "cfo": operating_cash,
        "net_income": net_income,
        "long_term_debt": total_debt,
        "long_term_debt_prev": total_debt_prev,
        "total_assets": total_assets,
        "total_assets_prev": total_assets_prev,
        "current_ratio": current_ratio,
        "current_ratio_prev": current_ratio_prev,
        "shares_outstanding": shares_out,
        "shares_outstanding_prev": shares_out_prev,
        "gross_margin": gross_margin,
        "gross_margin_prev": gross_margin_prev,
        "asset_turnover": asset_turnover,
        "asset_turnover_prev": asset_turnover_prev,
    }
    piotroski = piotroski_f_score(piotroski_input)

    wc = (current_assets - current_liabilities) if current_assets is not None and current_liabilities is not None else None
    altman = altman_z_score(
        {
            "working_capital": wc,
            "retained_earnings": retained_earnings,
            "ebit": operating_income,
            "market_value_equity": snapshot.get("market_cap"),
            "total_liabilities": total_liabilities,
            "sales": revenue,
            "total_assets": total_assets,
        }
    )

    book_value_per_share = (stock_equity / shares_out) if stock_equity is not None and shares_out else None
    graham = graham_number(diluted_eps or 0.0, book_value_per_share or 0.0)

    pe = _to_float(snapshot.get("pe")) or 0.0
    earnings_growth_pct = ((net_income - net_income_prev) / abs(net_income_prev) * 100.0) if net_income is not None and net_income_prev not in (None, 0) else 0.0
    peg = peg_ratio(pe, earnings_growth_pct)

    earnings_yield = (1.0 / pe) if pe else 0.0
    roic_base = (total_assets - current_liabilities) if total_assets is not None and current_liabilities is not None else None
    roic = (operating_income / roic_base) if operating_income is not None and roic_base not in (None, 0) else 0.0
    magic_rank = magic_formula_rank(earnings_yield, roic)

    dupont = dupont_analysis(net_income or 0.0, revenue or 0.0, total_assets or 0.0, stock_equity or 0.0)
    cogs = _pick_float(latest_income, ["costOfRevenue"])
    dso = ((receivables / revenue) * 365.0) if receivables is not None and revenue not in (None, 0) else 0.0
    dio = ((inventory / cogs) * 365.0) if inventory is not None and cogs not in (None, 0) else 0.0
    dpo = ((payables / cogs) * 365.0) if payables is not None and cogs not in (None, 0) else 0.0
    ccc = cash_conversion_cycle(dso, dio, dpo)
    fcfy = fcf_yield(free_cash or 0.0, _to_float(snapshot.get("market_cap")) or 0.0)

    revenue_cagr_3y = 0.0
    profit_cagr_3y = 0.0
    if len(income_rows) > 3:
        rev_3y = _pick_float(income_rows[3], ["revenue", "totalRevenue"])
        ni_3y = _pick_float(income_rows[3], ["netIncome"])
        if revenue is not None and rev_3y is not None:
            revenue_cagr_3y = cagr(rev_3y, revenue, 3)
        if net_income is not None and ni_3y is not None:
            profit_cagr_3y = cagr(ni_3y, net_income, 3)

    durability = max(0.0, min(100.0, (piotroski / 9.0) * 100.0))
    valuation = 80.0 if pe <= 15 else 65.0 if pe <= 25 else 45.0 if pe <= 40 else 30.0
    momentum = 50.0
    dvm = dvm_score(durability, valuation, momentum)

    return {
        "ticker": symbol,
        "piotroski_f_score": piotroski,
        "altman_z_score": round(altman, 4),
        "graham_number": round(graham, 4),
        "peg_ratio": round(peg, 4),
        "magic_formula_rank": round(magic_rank, 6),
        "dupont_analysis": dupont,
        "cash_conversion_cycle": round(ccc, 2),
        "fcf_yield_pct": round(fcfy, 4),
        "cagr": {
            "revenue_3y_pct": round(revenue_cagr_3y, 4),
            "profit_3y_pct": round(profit_cagr_3y, 4),
        },
        "dvm_score": dvm,
        "inputs": {
            "pe": pe,
            "earnings_growth_pct": earnings_growth_pct,
            "earnings_yield": earnings_yield,
            "roic": roic,
        },
    }
