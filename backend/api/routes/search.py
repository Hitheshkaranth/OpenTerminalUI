from __future__ import annotations

import asyncio
import csv
import re
from pathlib import Path
from typing import List, Dict

from fastapi import APIRouter, Query
from backend.adapters.registry import get_adapter_registry
from backend.api.deps import fetch_stock_snapshot_coalesced
from backend.core.models import SearchResponse, SearchResult
from backend.shared.market_classifier import market_classifier

router = APIRouter()
DATA_PATH = Path(__file__).resolve().parents[3] / "data" / "nse_equity_symbols_eq.csv"
_TICKER_LIKE_RE = re.compile(r"^[\^A-Za-z][A-Za-z0-9._=-]{0,12}$")

GLOBAL_INDICES = [
    SearchResult(ticker="^NSEI", name="NIFTY 50", exchange="NSE"),
    SearchResult(ticker="^BSESN", name="SENSEX", exchange="BSE"),
    SearchResult(ticker="^IXIC", name="NASDAQ", exchange="NASDAQ"),
    SearchResult(ticker="^GSPC", name="S&P 500", exchange="NYSE"),
    SearchResult(ticker="GC=F", name="GOLD", exchange="AMEX"),
    SearchResult(ticker="SI=F", name="SILVER", exchange="AMEX"),
    SearchResult(ticker="CL=F", name="CRUDE OIL", exchange="AMEX"),
]

# Global Cache
_SEARCH_CACHE: List[Dict[str, str]] = []
_CACHE_LOCK = asyncio.Lock()

async def _get_rows() -> List[Dict[str, str]]:
    global _SEARCH_CACHE
    if _SEARCH_CACHE:
        return _SEARCH_CACHE

    async with _CACHE_LOCK:
        if _SEARCH_CACHE:
            return _SEARCH_CACHE

        if not DATA_PATH.exists():
            return []

        # Offload file IO to thread
        def _read():
            with DATA_PATH.open("r", encoding="utf-8") as f:
                return list(csv.DictReader(f))

        try:
            rows = await asyncio.to_thread(_read)
            _SEARCH_CACHE = rows
        except Exception:
            _SEARCH_CACHE = []

        return _SEARCH_CACHE

@router.get("/search", response_model=SearchResponse)
async def search(q: str = Query(default=""), market: str = Query(default="NSE")) -> SearchResponse:
    query = q.strip().lower()
    if not query:
        return SearchResponse(query=q, results=[])

    _market = market if isinstance(market, str) else "NSE"
    selected_market = _market.strip().upper() or "NSE"
    rows = await _get_rows()
    matches: List[SearchResult] = []
    seen: set[str] = set()

    def _append_match(item: SearchResult) -> None:
        key = f"{item.ticker.upper()}::{(item.exchange or '').upper()}"
        if key in seen:
            return
        seen.add(key)
        matches.append(item)

    # Check global indices first
    for gi in GLOBAL_INDICES:
        if query in gi.ticker.lower() or query in gi.name.lower():
            _append_match(gi)

    # Simple search
    for row in rows:
        ticker = (row.get("Symbol") or row.get("SYMBOL") or row.get("symbol") or "").upper()
        name = row.get("Company Name") or row.get("NAME OF COMPANY") or row.get("name") or ticker

        # Check startswith for ticker for higher relevance match
        t_low = ticker.lower()
        n_low = name.lower()

        if query in t_low or query in n_low:
            _append_match(SearchResult(ticker=ticker, name=name, exchange="NSE"))

        if len(matches) >= 12:
            break

    # If no local NSE match, still allow direct symbol queries (e.g. AAPL, TSLA).
    if not matches and _TICKER_LIKE_RE.match(q.strip()):
        symbol = q.strip().upper()
        _append_match(SearchResult(ticker=symbol, name=symbol))

    try:
        registry = get_adapter_registry()
        target_markets: list[str] = [selected_market]
        for m in ("NASDAQ", "NYSE"):
            if m not in target_markets:
                target_markets.append(m)

        async def _search_market(mkt: str) -> list[SearchResult]:
            try:
                adapter = registry.get_adapter(mkt)
                rows = await adapter.search_instruments(q.strip())
                out: list[SearchResult] = []
                for row in rows[:15]:
                    out.append(
                        SearchResult(
                            ticker=row.symbol,
                            name=row.name,
                            exchange=row.exchange,
                        )
                    )
                return out
            except Exception:
                return []

        found_batches = await asyncio.gather(*(_search_market(mkt) for mkt in target_markets))
        for batch in found_batches:
            for item in batch:
                _append_match(item)
                if len(matches) >= 30:
                    break
            if len(matches) >= 30:
                break
    except Exception:
        pass

    if matches:
        sem = asyncio.Semaphore(16)

        async def _classify(entry: SearchResult) -> SearchResult:
            async with sem:
                try:
                    cls = await market_classifier.classify(entry.ticker)
                    resolved_name = entry.name
                    if not resolved_name or resolved_name.strip().upper() == entry.ticker.strip().upper():
                        try:
                            snap = await fetch_stock_snapshot_coalesced(entry.ticker)
                            company_name = str((snap or {}).get("company_name") or "").strip()
                            if company_name:
                                resolved_name = company_name
                        except Exception:
                            pass
                    return SearchResult(
                        ticker=entry.ticker,
                        name=resolved_name or entry.ticker,
                        exchange=cls.exchange,
                        country_code=cls.country_code,
                        flag_emoji=cls.flag_emoji,
                    )
                except Exception:
                    return entry

        matches = await asyncio.gather(*(_classify(item) for item in matches[:30]))

    return SearchResponse(query=q, results=matches)
