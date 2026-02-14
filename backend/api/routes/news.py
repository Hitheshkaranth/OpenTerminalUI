from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import get_unified_fetcher

router = APIRouter()

US_MARKETS = {"NYSE", "NASDAQ"}
IN_MARKETS = {"NSE", "BSE"}
SUPPORTED_MARKETS = US_MARKETS | IN_MARKETS


def _to_iso_from_epoch(value: Any) -> str | None:
    try:
        epoch = int(value)
    except (TypeError, ValueError):
        return None
    if epoch <= 0:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _stable_id(url: str, title: str, published_at: str) -> str:
    key = f"{url}|{title}|{published_at}".encode("utf-8")
    return hashlib.sha1(key).hexdigest()[:16]


def _normalize_items(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    dedup: dict[str, dict[str, str]] = {}
    for row in rows:
        url = str(row.get("url") or row.get("link") or "").strip()
        title = str(row.get("headline") or row.get("title") or "").strip()
        if not url or not title:
            continue
        source = str(row.get("source") or row.get("site") or "Unknown").strip() or "Unknown"
        summary = str(row.get("summary") or row.get("text") or "").strip()
        published_at = _to_iso_from_epoch(row.get("datetime")) or str(row.get("publishedAt") or "").strip()
        if not published_at:
            published_at = datetime.now(timezone.utc).isoformat()
        item = {
            "id": _stable_id(url, title, published_at),
            "title": title,
            "source": source,
            "publishedAt": published_at,
            "url": url,
            "summary": summary,
        }
        dedup[url] = item

    def _sort_key(item: dict[str, str]) -> float:
        try:
            return datetime.fromisoformat(item["publishedAt"].replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0

    return sorted(dedup.values(), key=_sort_key, reverse=True)


def _validate_market(market: str) -> str:
    market_code = market.strip().upper()
    if market_code not in SUPPORTED_MARKETS:
        raise HTTPException(status_code=400, detail=f"Unsupported market: {market_code}")
    return market_code


@router.get("/news/symbol")
async def get_symbol_news(
    market: str = Query(..., description="NSE|BSE|NYSE|NASDAQ"),
    symbol: str = Query(..., min_length=1, max_length=24),
    limit: int = Query(default=30, ge=1, le=100),
) -> dict[str, list[dict[str, str]]]:
    market_code = _validate_market(market)
    ticker = symbol.strip().upper()

    if market_code in IN_MARKETS:
        return {"items": []}

    fetcher = await get_unified_fetcher()
    if not fetcher.finnhub.api_key:
        return {"items": []}

    rows = await fetcher.finnhub.get_company_news(ticker, limit=limit)
    items = _normalize_items(rows if isinstance(rows, list) else [])
    return {"items": items[:limit]}


@router.get("/news/market")
async def get_market_news(
    market: str = Query(..., description="NSE|BSE|NYSE|NASDAQ"),
    limit: int = Query(default=30, ge=1, le=100),
) -> dict[str, list[dict[str, str]]]:
    market_code = _validate_market(market)

    if market_code in IN_MARKETS:
        return {"items": []}

    fetcher = await get_unified_fetcher()
    if not fetcher.finnhub.api_key:
        return {"items": []}

    rows = await fetcher.finnhub.get_market_news(category="general", limit=limit)
    items = _normalize_items(rows if isinstance(rows, list) else [])
    return {"items": items[:limit]}
