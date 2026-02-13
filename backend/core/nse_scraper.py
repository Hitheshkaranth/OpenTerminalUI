from __future__ import annotations


def fetch_nse_shareholding(symbol: str) -> dict[str, object]:
    return {"symbol": symbol.upper(), "data": [], "warning": "NSE scraper scaffold not yet implemented"}
