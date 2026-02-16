from __future__ import annotations

import asyncio

from backend.api.routes import news


def test_yahoo_news_row_normalization() -> None:
    row = {
        "title": "Apple rallies on earnings beat",
        "link": "https://example.com/apple-rally",
        "summary": "<p>Revenue beats estimates</p>",
        "publisher": "ExampleWire",
        "providerPublishTime": 1735689600,
    }
    item = news._yahoo_news_row_to_payload(row)  # type: ignore[attr-defined]
    assert item is not None
    assert item["title"] == "Apple rallies on earnings beat"
    assert item["url"] == "https://example.com/apple-rally"
    assert item["source"] == "ExampleWire"
    assert "Revenue beats estimates" in item["summary"]
    assert "sentiment" in item


def test_sentiment_uses_fallback_when_db_empty(monkeypatch) -> None:
    class _FakeQuery:
        def filter(self, *args, **kwargs):  # noqa: ANN002, ANN003
            return self

        def order_by(self, *args, **kwargs):  # noqa: ANN002, ANN003
            return self

        def all(self):
            return []

    class _FakeSession:
        def query(self, *args, **kwargs):  # noqa: ANN002, ANN003
            return _FakeQuery()

        def close(self) -> None:
            return None

    monkeypatch.setattr(news, "SessionLocal", lambda: _FakeSession())

    async def _fake_fallback(query: str, limit: int = 50):  # noqa: ARG001
        return [
            {
                "title": "Apple upbeat guidance",
                "url": "https://example.com/a1",
                "summary": "Strong iPhone demand",
                "source": "Example",
                "published_at": "2026-02-15T10:00:00+00:00",
                "sentiment": {"score": 0.5, "label": "Bullish", "confidence": 0.8},
            },
            {
                "title": "Apple faces supply risks",
                "url": "https://example.com/a2",
                "summary": "Short-term margin pressure",
                "source": "Example",
                "published_at": "2026-02-15T14:00:00+00:00",
                "sentiment": {"score": -0.2, "label": "Bearish", "confidence": 0.7},
            },
        ]

    async def _fake_cache_get(key: str):  # noqa: ARG001
        return None

    async def _fake_cache_set(key: str, payload, ttl: int):  # noqa: ANN001, ARG001
        return None

    monkeypatch.setattr(news, "_fetch_news_fallback", _fake_fallback)
    monkeypatch.setattr(news.cache_instance, "get", _fake_cache_get)
    monkeypatch.setattr(news.cache_instance, "set", _fake_cache_set)

    result = asyncio.run(news.get_news_sentiment("AAPL", days=7))
    assert result["total_articles"] == 2
    assert result["bullish_pct"] == 50.0
    assert result["bearish_pct"] == 50.0
    assert len(result["daily_sentiment"]) == 1

