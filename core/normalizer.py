from __future__ import annotations

from typing import Any

import pandas as pd


def _safe_get(info: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in info:
            return info[key]
    return None


def normalize_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Normalizes raw API payload into a flat schema used by ratios/screener."""
    info = snapshot.get("info", {}) or {}
    history = snapshot.get("history_1y")
    close = None
    if isinstance(history, pd.DataFrame) and not history.empty and "Close" in history.columns:
        close = float(history["Close"].iloc[-1])

    return {
        "ticker": snapshot.get("ticker"),
        "symbol": snapshot.get("symbol"),
        "company_name": _safe_get(info, "shortName", "longName"),
        "sector": _safe_get(info, "sector"),
        "industry": _safe_get(info, "industry"),
        "market_cap": _safe_get(info, "marketCap"),
        "current_price": close if close is not None else _safe_get(info, "currentPrice", "regularMarketPrice"),
        "trailing_eps": _safe_get(info, "trailingEps"),
        "forward_eps": _safe_get(info, "forwardEps"),
        "book_value": _safe_get(info, "bookValue"),
        "trailing_pe": _safe_get(info, "trailingPE"),
        "forward_pe": _safe_get(info, "forwardPE"),
        "price_to_book": _safe_get(info, "priceToBook"),
        "price_to_sales": _safe_get(info, "priceToSalesTrailing12Months"),
        "enterprise_value": _safe_get(info, "enterpriseValue"),
        "ebitda": _safe_get(info, "ebitda"),
        "total_debt": _safe_get(info, "totalDebt"),
        "total_cash": _safe_get(info, "totalCash"),
        "revenue_ttm": _safe_get(info, "totalRevenue"),
        "gross_margin": _safe_get(info, "grossMargins"),
        "operating_margin": _safe_get(info, "operatingMargins"),
        "profit_margin": _safe_get(info, "profitMargins"),
        "return_on_equity": _safe_get(info, "returnOnEquity"),
        "return_on_assets": _safe_get(info, "returnOnAssets"),
        "revenue_growth": _safe_get(info, "revenueGrowth"),
        "earnings_growth": _safe_get(info, "earningsGrowth"),
        "dividend_yield": _safe_get(info, "dividendYield"),
        "payout_ratio": _safe_get(info, "payoutRatio"),
        "beta": _safe_get(info, "beta"),
    }
