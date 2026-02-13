from __future__ import annotations


def fetch_bse_financials(symbol: str) -> dict[str, object]:
    return {"symbol": symbol.upper(), "data": [], "warning": "BSE scraper scaffold not yet implemented"}
