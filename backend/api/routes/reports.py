from __future__ import annotations

import asyncio
from typing import Any, List, Dict

from fastapi import APIRouter

from backend.api.deps import get_unified_fetcher

router = APIRouter()


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        out = float(value)
        return out if out == out else None
    if isinstance(value, str):
        cleaned = value.replace(",", "").strip()
        if cleaned in ("", "-", "NA", "N/A", "null", "None"):
            return None
        try:
            out = float(cleaned)
            return out if out == out else None
        except ValueError:
            return None
    return None


def _extract_index_metrics(payload: Dict[str, Any], accepted_names: set[str]) -> tuple[float | None, float | None]:
    candidates: list[dict[str, Any]] = []
    for key in ("data", "indexList", "indices", "results"):
        node = payload.get(key)
        if isinstance(node, list):
            candidates.extend([x for x in node if isinstance(x, dict)])
    if not candidates and payload:
        candidates = [payload]

    for row in candidates:
        name = str(
            row.get("index")
            or row.get("indexName")
            or row.get("name")
            or row.get("symbol")
            or ""
        ).strip().upper()
        if name not in accepted_names:
            continue
        value_out: float | None = None
        pct_out: float | None = None
        for value_key in ("last", "lastPrice", "ltp", "indexValue", "value", "current"):
            parsed = _to_float(row.get(value_key))
            if parsed is not None:
                value_out = parsed
                break
        for pct_key in ("pChange", "percentChange", "changePercent", "netChangePercent"):
            parsed = _to_float(row.get(pct_key))
            if parsed is not None:
                pct_out = parsed
                break
        if value_out is not None or pct_out is not None:
            return value_out, pct_out
    return None, None

@router.get("/reports/bulk-deals")
async def bulk_deals() -> Dict[str, Any]:
    fetcher = await get_unified_fetcher()
    try:
        data = await fetcher.nse.get_bulk_deals()
        return data
    except Exception as e:
        return {"error": str(e), "data": []}

@router.get("/reports/block-deals")
async def block_deals() -> Dict[str, Any]:
    fetcher = await get_unified_fetcher()
    try:
        data = await fetcher.nse.get_block_deals()
        return data
    except Exception as e:
        return {"error": str(e), "data": []}

@router.get("/reports/market-status")
async def market_status() -> Dict[str, Any]:
    fetcher = await get_unified_fetcher()
    nse_market_task = fetcher.nse.get_market_status()
    nse_indices_task = fetcher.nse.get_index_quote("NIFTY 50")
    yahoo_quotes_task = fetcher.yahoo.get_quotes(
        ["^NSEI", "^BSESN", "^GSPC", "^N225", "^HSI", "INRUSD=X", "USDINR=X"]
    )

    nse_market_raw, nse_indices_raw, yahoo_quotes_raw = await asyncio.gather(
        nse_market_task,
        nse_indices_task,
        yahoo_quotes_task,
        return_exceptions=True,
    )

    market_payload = nse_market_raw if isinstance(nse_market_raw, dict) else {}
    indices_payload = nse_indices_raw if isinstance(nse_indices_raw, dict) else {}
    yahoo_quotes = yahoo_quotes_raw if isinstance(yahoo_quotes_raw, list) else []

    nifty, nifty_pct = _extract_index_metrics(indices_payload, {"NIFTY 50", "NIFTY50", "NIFTY"})
    sensex, sensex_pct = _extract_index_metrics(indices_payload, {"SENSEX", "BSE SENSEX"})
    inr_usd: float | None = None
    usd_inr: float | None = None
    sp500: float | None = None
    nikkei225: float | None = None
    hangseng: float | None = None
    inr_usd_pct: float | None = None
    usd_inr_pct: float | None = None
    sp500_pct: float | None = None
    nikkei225_pct: float | None = None
    hangseng_pct: float | None = None

    yahoo_map: dict[str, dict[str, Any]] = {}
    for item in yahoo_quotes:
        if isinstance(item, dict):
            sym = str(item.get("symbol") or "").upper()
            if sym:
                yahoo_map[sym] = item

    used_yahoo_fallback = False
    if nifty is None:
        quote = yahoo_map.get("^NSEI") or {}
        nifty = _to_float(quote.get("regularMarketPrice"))
        if nifty_pct is None:
            nifty_pct = _to_float(quote.get("regularMarketChangePercent"))
        used_yahoo_fallback = used_yahoo_fallback or nifty is not None
    if sensex is None:
        quote = yahoo_map.get("^BSESN") or {}
        sensex = _to_float(quote.get("regularMarketPrice"))
        if sensex_pct is None:
            sensex_pct = _to_float(quote.get("regularMarketChangePercent"))
        used_yahoo_fallback = used_yahoo_fallback or sensex is not None
    inr_quote = yahoo_map.get("INRUSD=X") or {}
    inr_usd = _to_float(inr_quote.get("regularMarketPrice"))
    inr_usd_pct = _to_float(inr_quote.get("regularMarketChangePercent"))
    usd_quote = yahoo_map.get("USDINR=X") or {}
    usd_inr = _to_float(usd_quote.get("regularMarketPrice"))
    usd_inr_pct = _to_float(usd_quote.get("regularMarketChangePercent"))
    sp_quote = yahoo_map.get("^GSPC") or {}
    sp500 = _to_float(sp_quote.get("regularMarketPrice"))
    sp500_pct = _to_float(sp_quote.get("regularMarketChangePercent"))
    nk_quote = yahoo_map.get("^N225") or {}
    nikkei225 = _to_float(nk_quote.get("regularMarketPrice"))
    nikkei225_pct = _to_float(nk_quote.get("regularMarketChangePercent"))
    hs_quote = yahoo_map.get("^HSI") or {}
    hangseng = _to_float(hs_quote.get("regularMarketPrice"))
    hangseng_pct = _to_float(hs_quote.get("regularMarketChangePercent"))
    if usd_inr is None and inr_usd not in (None, 0):
        usd_inr = round(1.0 / inr_usd, 6)
    if usd_inr_pct is None and inr_usd_pct is not None:
        usd_inr_pct = -inr_usd_pct

    fallback_enabled = bool(used_yahoo_fallback or (nifty is None and sensex is None))
    market_state = market_payload.get("marketState")
    if not isinstance(market_state, list):
        market_state = []

    response: Dict[str, Any] = {
        "marketState": market_state,
        "nifty50": nifty,
        "nifty50Pct": nifty_pct,
        "sensex": sensex,
        "sensexPct": sensex_pct,
        "inrUsd": inr_usd,
        "inrUsdPct": inr_usd_pct,
        "usdInr": usd_inr,
        "usdInrPct": usd_inr_pct,
        "sp500": sp500,
        "sp500Pct": sp500_pct,
        "nikkei225": nikkei225,
        "nikkei225Pct": nikkei225_pct,
        "hangseng": hangseng,
        "hangsengPct": hangseng_pct,
        "fallbackEnabled": fallback_enabled,
        "source": {
            "nseMarketStatus": isinstance(nse_market_raw, dict),
            "nseIndices": isinstance(nse_indices_raw, dict),
            "yahooFallback": used_yahoo_fallback or inr_usd is not None,
        },
    }

    if (
        nifty is None
        and sensex is None
        and inr_usd is None
        and usd_inr is None
        and sp500 is None
        and nikkei225 is None
        and hangseng is None
        and not market_state
    ):
        errors: list[str] = []
        if isinstance(nse_market_raw, Exception):
            errors.append(f"NSE market status: {nse_market_raw}")
        if isinstance(nse_indices_raw, Exception):
            errors.append(f"NSE indices: {nse_indices_raw}")
        if isinstance(yahoo_quotes_raw, Exception):
            errors.append(f"Yahoo quotes: {yahoo_quotes_raw}")
        if errors:
            response["error"] = " | ".join(errors)

    return response

@router.get("/reports/events")
async def events() -> List[Dict[str, Any]]:
    # Mock events for now or fetch from a calendar source if available
    # NSE doesn't have a simple public "calendar" endpoint without scraping
    # We will return some mock upcoming results/events for demo
    return [
        {"date": "2024-10-15", "ticker": "RELIANCE", "event": "Q2 Earnings"},
        {"date": "2024-10-16", "ticker": "INFY", "event": "AGM"},
        {"date": "2024-10-18", "ticker": "TCS", "event": "Dividend Ex-Date"},
        {"date": "2024-10-20", "ticker": "HDFCBANK", "event": "Q2 Earnings"},
    ]
