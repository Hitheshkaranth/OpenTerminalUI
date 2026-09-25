from __future__ import annotations

from fastapi import HTTPException
import pytest

import asyncio

from backend.api.routes import news


class _FakeRow:
    def __init__(
        self,
        title: str,
        summary: str,
        published_at: str,
        sentiment_score: float | None = None,
        sentiment_label: str | None = None,
        sentiment_confidence: float | None = None,
    ) -> None:
        self.id = 1
        self.source = "Src"
        self.title = title
        self.url = "https://example.com/a"
        self.summary = summary
        self.image_url = ""
        self.published_at = published_at
        self.tickers = '["RELIANCE"]'
        self.sentiment_score = sentiment_score
        self.sentiment_label = sentiment_label
        self.sentiment_confidence = sentiment_confidence


class _FakeQuery:
    def __init__(self, rows: list[_FakeRow]) -> None:
        self._rows = rows

    def filter(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return self

    def order_by(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return self

    def limit(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return self

    def all(self):
        return self._rows


class _FakeSession:
    def __init__(self, rows: list[_FakeRow]) -> None:
        self._rows = rows

    def query(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return _FakeQuery(self._rows)

    def close(self) -> None:
        return None


def test_news_sentiment_summary_aggregates_payload(monkeypatch) -> None:
    rows = [
        _FakeRow(
            title="Strong demand and order win",
            summary="massive defence order",
            published_at="2026-02-10T09:00:00+00:00",
            sentiment_score=0.6,
            sentiment_label="Bullish",
            sentiment_confidence=0.8,
        ),
        _FakeRow(
            title="Guidance cut amid weak demand",
            summary="fii outflow continues",
            published_at="2026-02-10T15:00:00+00:00",
            sentiment_score=-0.5,
            sentiment_label="Bearish",
            sentiment_confidence=0.7,
        ),
        _FakeRow(
            title="Company update",
            summary="no major change",
            published_at="2026-02-11T12:00:00+00:00",
            sentiment_score=0.0,
            sentiment_label="Neutral",
            sentiment_confidence=0.2,
        ),
    ]

    monkeypatch.setattr(news, "SessionLocal", lambda: _FakeSession(rows))

    async def _fake_cache_get(key: str):  # noqa: ARG001
        return None

    async def _fake_cache_set(key: str, payload, ttl: int):  # noqa: ANN001, ARG001
        return None

    monkeypatch.setattr(news.cache_instance, "get", _fake_cache_get)
    monkeypatch.setattr(news.cache_instance, "set", _fake_cache_set)

    result = asyncio.run(news.get_news_sentiment("RELIANCE", days=7))
    assert result["ticker"] == "RELIANCE"
    assert result["period_days"] == 7
    assert result["total_articles"] == 3
    assert result["overall_label"] == "Neutral"
    assert len(result["daily_sentiment"]) == 2


def test_news_sentiment_market_summary_payload(monkeypatch) -> None:
    rows = [
        _FakeRow(
            title="Order pipeline remains strong",
            summary="record quarterly order inflows",
            published_at="2026-02-10T09:00:00+00:00",
            sentiment_score=0.5,
            sentiment_label="Bullish",
            sentiment_confidence=0.8,
        ),
        _FakeRow(
            title="Margins under pressure",
            summary="guidance trimmed",
            published_at="2026-02-11T11:00:00+00:00",
            sentiment_score=-0.4,
            sentiment_label="Bearish",
            sentiment_confidence=0.7,
        ),
    ]
    rows[0].source = "WireA"
    rows[1].source = "WireB"

    monkeypatch.setattr(news, "SessionLocal", lambda: _FakeSession(rows))

    async def _fake_cache_get(key: str):  # noqa: ARG001
        return None

    async def _fake_cache_set(key: str, payload, ttl: int):  # noqa: ANN001, ARG001
        return None

    monkeypatch.setattr(news.cache_instance, "get", _fake_cache_get)
    monkeypatch.setattr(news.cache_instance, "set", _fake_cache_set)

    result = asyncio.run(news.get_news_sentiment_summary(days=7, limit=100))
    assert result["period_days"] == 7
    assert result["total_articles"] == 2
    assert "distribution" in result
    assert "top_sources" in result


def test_news_by_ticker_blank_ticker_does_not_match_every_article(monkeypatch) -> None:
    """A blank ticker yields no aliases; or_() with no args used to drop the filter
    and return every article in the table."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from backend.db.models import NewsArticle
    from backend.shared.db import Base

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[NewsArticle.__table__])
    TestSession = sessionmaker(bind=engine)
    with TestSession() as db:
        db.add(NewsArticle(source="Src", title="Reliance news", url="https://example.com/r", published_at="2026-02-10T09:00:00+00:00", tickers='["RELIANCE"]'))
        db.commit()

    async def _no_cache(*_args, **_kwargs):
        return None

    async def _no_fallback(*_args, **_kwargs):
        return []

    monkeypatch.setattr(news.cache_instance, "get", _no_cache)
    monkeypatch.setattr(news.cache_instance, "set", _no_cache)
    monkeypatch.setattr(news, "_fetch_news_fallback", _no_fallback)
    monkeypatch.setattr(news, "SessionLocal", TestSession)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(news.get_news_by_ticker(" ", limit=50, market=None))
    assert exc.value.status_code == 400

    hit = asyncio.run(news.get_news_by_ticker("RELIANCE", limit=50, market=None))
    assert [item["title"] for item in hit["items"]] == ["Reliance news"]
