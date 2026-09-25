"""Per-stock news emotion endpoint.

Surfaces a fear<->greed style emotion indicator for a specific ticker, derived
from recent news analyzed by a locally hosted Gemma model (via LM Studio).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import desc, or_
from sqlalchemy.exc import OperationalError

from backend.api.deps import cache_instance
from backend.api.routes.news import (
    _fetch_news_fallback,
    _ticker_aliases,
    _ticker_fallback_terms,
)
from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.db.models import NewsArticle
from backend.services.stock_emotion import analyze_stock_emotion
from backend.shared.db import SessionLocal

router = APIRouter()


def _load_db_articles(symbol: str, market_code: str | None, days: int) -> list[dict[str, Any]]:
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    aliases = _ticker_aliases(symbol, market_code)
    if not aliases:
        # An empty or_() drops the ticker filter and would match every article.
        return []
    db = SessionLocal()
    try:
        ticker_filters = [NewsArticle.tickers.like(f'%"{alias}"%') for alias in aliases]
        rows = (
            db.query(NewsArticle)
            .filter(or_(*ticker_filters), NewsArticle.published_at >= cutoff_iso)
            .order_by(desc(NewsArticle.published_at))
            .limit(60)
            .all()
        )
    except OperationalError:
        return []
    finally:
        db.close()
    return [
        {
            "title": row.title or "",
            "summary": row.summary or "",
            "source": row.source or "Unknown",
            "url": row.url or "",
            "published_at": row.published_at or "",
        }
        for row in rows
    ]


@router.get("/sentiment/emotion/{ticker}")
async def get_stock_emotion(
    ticker: str,
    days: int = Query(default=7, ge=1, le=30),
    market: str | None = Query(default=None, description="Optional market context e.g. NSE/BSE/NASDAQ"),
    limit: int = Query(default=6, ge=3, le=30),
) -> dict[str, Any]:
    """Return an aggregated emotion profile for a ticker's recent news."""
    if not isinstance(market, str):
        market = None
    symbol = ticker.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="ticker is required")
    market_code = (market or "").strip().upper() or None

    cache_key = cache_instance.build_key(
        "news_latest",
        f"emotion:{symbol}",
        {"days": days, "market": market_code or "", "limit": limit},
    )
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    articles = _load_db_articles(symbol, market_code, days)
    if not articles:
        for term in _ticker_fallback_terms(symbol, market_code):
            articles = await _fetch_news_fallback(term, limit=max(limit, days * 6))
            if articles:
                break

    payload = await analyze_stock_emotion(symbol, articles, period_days=days, limit=limit)
    await cache_instance.set(
        cache_key,
        payload,
        ttl=ttl_seconds("news_latest", market_open_now()),
    )
    return payload
