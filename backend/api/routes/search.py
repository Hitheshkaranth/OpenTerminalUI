from __future__ import annotations

import asyncio
import csv
import re
from pathlib import Path
from typing import List, Dict

from fastapi import APIRouter, Query
from backend.adapters.registry import get_adapter_registry
from backend.core.models import SearchResponse, SearchResult
from backend.shared.market_classifier import market_classifier

router = APIRouter()
DATA_PATH = Path(__file__).resolve().parents[3] / "data" / "nse_equity_symbols_eq.csv"
_TICKER_LIKE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,9}$")

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
        
    rows = await _get_rows()
    matches: List[SearchResult] = []
    
    # Simple search
    for row in rows:
        ticker = (row.get("Symbol") or row.get("SYMBOL") or row.get("symbol") or "").upper()
        name = row.get("Company Name") or row.get("NAME OF COMPANY") or row.get("name") or ticker
        
        # Check startswith for ticker for higher relevance match
        t_low = ticker.lower()
        n_low = name.lower()
        
        if query in t_low or query in n_low:
            matches.append(SearchResult(ticker=ticker, name=name))
            
        if len(matches) >= 20:
            break

    # If no local NSE match, still allow direct symbol queries (e.g. AAPL, TSLA).
    if not matches and _TICKER_LIKE_RE.match(q.strip()):
        symbol = q.strip().upper()
        matches.append(SearchResult(ticker=symbol, name=symbol))

    if not matches:
        try:
            registry = get_adapter_registry()
            adapter = registry.get_adapter(market)
            rows = await adapter.search_instruments(q.strip())
            for row in rows[:20]:
                matches.append(
                    SearchResult(
                        ticker=row.symbol,
                        name=row.name,
                        exchange=row.exchange,
                    )
                )
        except Exception:
            pass

    if matches:
        sem = asyncio.Semaphore(16)

        async def _classify(entry: SearchResult) -> SearchResult:
            async with sem:
                try:
                    cls = await market_classifier.classify(entry.ticker)
                    return SearchResult(
                        ticker=entry.ticker,
                        name=entry.name,
                        exchange=cls.exchange,
                        country_code=cls.country_code,
                        flag_emoji=cls.flag_emoji,
                    )
                except Exception:
                    return entry

        matches = await asyncio.gather(*(_classify(item) for item in matches))

    return SearchResponse(query=q, results=matches)
