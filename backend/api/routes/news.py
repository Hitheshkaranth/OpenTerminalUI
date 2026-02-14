from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import desc, or_
from sqlalchemy.exc import OperationalError

from backend.api.deps import cache_instance, get_unified_fetcher
from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.db.database import SessionLocal
from backend.db.models import NewsArticle

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


def _row_to_item(row: NewsArticle) -> dict[str, Any]:
    tickers: list[str] = []
    try:
        parsed = json.loads(row.tickers or "[]")
        if isinstance(parsed, list):
            tickers = [str(v).upper() for v in parsed if str(v).strip()]
    except Exception:
        tickers = []
    return {
        "id": row.id,
        "source": row.source,
        "title": row.title,
        "url": row.url,
        "summary": row.summary,
        "image_url": row.image_url,
        "published_at": row.published_at,
        "tickers": tickers,
    }


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


@router.get("/news/latest")
async def get_latest_news(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    cache_key = cache_instance.build_key("news_latest", "all", {"limit": limit})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    db = SessionLocal()
    try:
        rows = db.query(NewsArticle).order_by(desc(NewsArticle.published_at)).limit(limit).all()
        payload = {"items": [_row_to_item(row) for row in rows]}
    except OperationalError:
        payload = {"items": []}
    finally:
        db.close()

    await cache_instance.set(
        cache_key,
        payload,
        ttl=ttl_seconds("news_latest", market_open_now()),
    )
    return payload


@router.get("/news/search")
async def search_news(
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    term = q.strip()
    cache_key = cache_instance.build_key("news_latest", "search", {"q": term.lower(), "limit": limit})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    db = SessionLocal()
    try:
        like = f"%{term}%"
        rows = (
            db.query(NewsArticle)
            .filter(
                or_(
                    NewsArticle.title.ilike(like),
                    NewsArticle.summary.ilike(like),
                    NewsArticle.source.ilike(like),
                )
            )
            .order_by(desc(NewsArticle.published_at))
            .limit(limit)
            .all()
        )
        payload = {"items": [_row_to_item(row) for row in rows]}
    except OperationalError:
        payload = {"items": []}
    finally:
        db.close()

    await cache_instance.set(
        cache_key,
        payload,
        ttl=ttl_seconds("news_latest", market_open_now()),
    )
    return payload


@router.get("/news/by-ticker/{ticker}")
async def get_news_by_ticker(ticker: str, limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    symbol = ticker.strip().upper()
    cache_key = cache_instance.build_key("news_latest", f"ticker:{symbol}", {"limit": limit})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    db = SessionLocal()
    try:
        like = f'%"{symbol}"%'
        rows = (
            db.query(NewsArticle)
            .filter(NewsArticle.tickers.like(like))
            .order_by(desc(NewsArticle.published_at))
            .limit(limit)
            .all()
        )
        payload = {"items": [_row_to_item(row) for row in rows]}
    except OperationalError:
        payload = {"items": []}
    finally:
        db.close()

    await cache_instance.set(
        cache_key,
        payload,
        ttl=ttl_seconds("news_latest", market_open_now()),
    )
    return payload
