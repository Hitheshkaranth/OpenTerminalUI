from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from backend.api.deps import get_unified_fetcher
from backend.db.database import SessionLocal
from backend.db.models import Holding, NewsArticle, WatchlistItem
from nlp.sentiment import score_financial_sentiment

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_iso(raw: Any) -> str:
    if isinstance(raw, (int, float)):
        if raw > 0:
            return datetime.fromtimestamp(raw, tz=timezone.utc).isoformat()
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return _now_iso()
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
        except Exception:
            return _now_iso()
    return _now_iso()


def _normalize_tickers(raw: Any) -> list[str]:
    if isinstance(raw, str):
        symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]
        return list(dict.fromkeys(symbols))
    if isinstance(raw, list):
        symbols = [str(s).strip().upper() for s in raw if str(s).strip()]
        return list(dict.fromkeys(symbols))
    return []


def _db_tickers(limit: int = 40) -> list[str]:
    db = SessionLocal()
    try:
        holdings = [str(r[0]).strip().upper() for r in db.query(Holding.ticker).limit(limit).all() if r and r[0]]
        watchlist = [str(r[0]).strip().upper() for r in db.query(WatchlistItem.ticker).limit(limit).all() if r and r[0]]
        merged = list(dict.fromkeys([*holdings, *watchlist]))
        return merged[:limit]
    except Exception:
        return []
    finally:
        db.close()


@dataclass
class NormalizedNews:
    source: str
    title: str
    url: str
    summary: str
    image_url: str
    published_at: str
    tickers: list[str]
    sentiment_score: float = 0.0
    sentiment_label: str = "Neutral"
    sentiment_confidence: float = 0.0


def normalize_news_record(row: dict[str, Any], provider: str) -> NormalizedNews | None:
    if not isinstance(row, dict):
        return None
    provider_key = (provider or "").strip().lower()
    if provider_key == "finnhub":
        url = str(row.get("url") or "").strip()
        title = str(row.get("headline") or row.get("title") or "").strip()
        if not url or not title:
            return None
        payload = NormalizedNews(
            source=str(row.get("source") or "Finnhub").strip() or "Finnhub",
            title=title,
            url=url,
            summary=str(row.get("summary") or "").strip(),
            image_url=str(row.get("image") or "").strip(),
            published_at=_to_iso(row.get("datetime")),
            tickers=_normalize_tickers(row.get("related")),
        )
        _attach_sentiment(payload)
        return payload

    if provider_key == "fmp":
        url = str(row.get("url") or row.get("link") or "").strip()
        title = str(row.get("title") or row.get("headline") or "").strip()
        if not url or not title:
            return None
        payload = NormalizedNews(
            source=str(row.get("site") or row.get("source") or "FMP").strip() or "FMP",
            title=title,
            url=url,
            summary=str(row.get("text") or row.get("summary") or "").strip(),
            image_url=str(row.get("image") or row.get("image_url") or "").strip(),
            published_at=_to_iso(row.get("publishedDate") or row.get("publishedAt")),
            tickers=_normalize_tickers(row.get("symbol") or row.get("ticker")),
        )
        _attach_sentiment(payload)
        return payload
    return None


def _attach_sentiment(item: NormalizedNews) -> None:
    text = f"{item.title}. {item.summary}".strip()
    sentiment = score_financial_sentiment(text)
    item.sentiment_score = float(sentiment.get("score", 0.0))
    item.sentiment_label = str(sentiment.get("label", "Neutral"))
    item.sentiment_confidence = float(sentiment.get("confidence", 0.0))


class NewsIngestor:
    def __init__(self) -> None:
        self._scheduler: Any = None
        self._lock = asyncio.Lock()
        self._last_ingest_at: str | None = None
        self._last_ingest_status: str = "never"

    def status_snapshot(self) -> dict[str, str | None]:
        return {
            "last_news_ingest_at": self._last_ingest_at,
            "last_news_ingest_status": self._last_ingest_status,
        }

    async def start(self) -> None:
        if self._scheduler and self._scheduler.running:
            return
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
            from apscheduler.triggers.interval import IntervalTrigger  # type: ignore
        except Exception as exc:
            logger.warning("News ingestor disabled: APScheduler unavailable (%s)", exc)
            self._last_ingest_status = "scheduler_unavailable"
            return
        scheduler = AsyncIOScheduler(timezone="UTC")
        scheduler.add_job(
            self._run_safe,
            trigger=IntervalTrigger(minutes=3),
            id="news-ingestor",
            max_instances=1,
            coalesce=True,
            replace_existing=True,
            next_run_time=datetime.now(timezone.utc),
        )
        scheduler.start()
        self._scheduler = scheduler
        logger.info("event=news_ingestor_scheduler_started interval_minutes=3")

    async def stop(self) -> None:
        if not self._scheduler:
            return
        self._scheduler.shutdown(wait=True)
        self._scheduler = None
        logger.info("event=news_ingestor_scheduler_stopped")

    async def _run_safe(self) -> None:
        async with self._lock:
            started_at = _now_iso()
            self._last_ingest_at = started_at
            logger.info("event=news_ingest_run_start at=%s", started_at)
            try:
                inserted = await self.ingest_once()
                self._last_ingest_status = f"ok:{inserted}"
                logger.info("event=news_ingest_run_complete inserted=%s", inserted)
            except Exception as exc:
                self._last_ingest_status = "error"
                logger.warning("News ingest run failed: %s", exc)

    async def ingest_once(self) -> int:
        fetcher = await get_unified_fetcher()
        items: list[NormalizedNews] = []
        if fetcher.finnhub.api_key:
            items = await self._fetch_finnhub(fetcher)
        elif fetcher.fmp.api_key:
            items = await self._fetch_fmp(fetcher)
        else:
            self._last_ingest_status = "skipped:no_provider_key"
            logger.info("event=news_ingest_skipped reason=no_provider_key")
            return 0
        if not items:
            self._last_ingest_status = "ok:0"
            logger.info("event=news_ingest_no_items")
            return 0
        inserted = await asyncio.to_thread(self._store_news, items)
        logger.info("event=news_ingest_store inserted=%s candidates=%s", inserted, len(items))
        return inserted

    async def _fetch_finnhub(self, fetcher: Any) -> list[NormalizedNews]:
        rows = await fetcher.finnhub.get_market_news(category="general", limit=120)
        normalized: list[NormalizedNews] = []
        for row in rows if isinstance(rows, list) else []:
            item = normalize_news_record(row, provider="finnhub")
            if item:
                normalized.append(item)
        return self._dedupe(normalized)

    async def _fetch_fmp(self, fetcher: Any) -> list[NormalizedNews]:
        rows: list[dict[str, Any]] = []
        base = await fetcher.fmp._get("/stock_news", {"limit": 120})
        if isinstance(base, list):
            rows.extend([r for r in base if isinstance(r, dict)])

        today = date.today()
        frm = (today - timedelta(days=2)).isoformat()
        to = today.isoformat()
        for ticker in _db_tickers():
            stock_rows = await fetcher.fmp._get("/stock_news", {"tickers": ticker, "from": frm, "to": to, "limit": 20})
            if isinstance(stock_rows, list):
                rows.extend([r for r in stock_rows if isinstance(r, dict)])

        normalized: list[NormalizedNews] = []
        for row in rows:
            item = normalize_news_record(row, provider="fmp")
            if item:
                normalized.append(item)
        return self._dedupe(normalized)

    def _dedupe(self, items: list[NormalizedNews]) -> list[NormalizedNews]:
        by_url: dict[str, NormalizedNews] = {}
        for item in items:
            if not item.url:
                continue
            by_url[item.url] = item
        return list(by_url.values())

    def _store_news(self, items: list[NormalizedNews]) -> int:
        if not items:
            return 0
        db = SessionLocal()
        try:
            urls = [i.url for i in items if i.url]
            existing = {
                str(row[0]) for row in db.query(NewsArticle.url).filter(NewsArticle.url.in_(urls)).all() if row and row[0]
            }
            inserted = 0
            now_iso = _now_iso()
            for item in items:
                if not item.url or item.url in existing:
                    continue
                db.add(
                    NewsArticle(
                        source=item.source[:128],
                        title=item.title[:1024],
                        url=item.url[:2048],
                        summary=item.summary[:4096],
                        image_url=item.image_url[:2048],
                        published_at=item.published_at,
                        tickers=json.dumps(item.tickers),
                        sentiment_score=item.sentiment_score,
                        sentiment_label=item.sentiment_label[:16],
                        sentiment_confidence=item.sentiment_confidence,
                        created_at=now_iso,
                    )
                )
                inserted += 1
            if inserted:
                db.commit()
            return inserted
        except Exception:
            db.rollback()
            return 0
        finally:
            db.close()


_news_ingestor = NewsIngestor()


def get_news_ingestor() -> NewsIngestor:
    return _news_ingestor
