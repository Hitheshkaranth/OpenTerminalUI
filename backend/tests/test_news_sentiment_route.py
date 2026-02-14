from __future__ import annotations

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
