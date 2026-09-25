"""Tests for the provider-backed stock emotion analysis service."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from backend.services import stock_emotion
from backend.services.llm.base import AssistantMessage
from backend.services.lm_studio_client import LMStudioError, parse_json_response


def _fake_settings(provider: str = "openrouter") -> SimpleNamespace:
    return SimpleNamespace(
        agent_provider=provider,
        agent_model="test-model",
        lm_studio_model="google/gemma-4-26b-a4b",
        lm_studio_enabled=False,
    )


def _stub_sentiment(text: str) -> dict:
    lowered = (text or "").lower()
    if any(term in lowered for term in ("beat", "profit", "record")):
        return {"score": 0.6, "label": "Bullish", "confidence": 0.7}
    if any(term in lowered for term in ("fraud", "loss", "downgrade")):
        return {"score": -0.6, "label": "Bearish", "confidence": 0.7}
    return {"score": 0.0, "label": "Neutral", "confidence": 0.3}


class _FakeProvider:
    """Stand-in for an OpenAI-compatible provider (OpenRouter/LM Studio/etc.)."""

    def __init__(self, api_key: str | None = "k", model: str = "test-model") -> None:
        self.api_key = api_key
        self.model = model

    async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024) -> AssistantMessage:  # noqa: ANN001
        return AssistantMessage(
            content=(
                '{"analyses": [{"sentiment_score": 0.5, "sentiment_label": "Bullish", '
                '"confidence": 0.8, "emotion": "optimism", '
                '"emotion_intensity": 0.7, "rationale": "Strong quarterly results."}]}'
            )
        )


def test_emotion_index_label_buckets() -> None:
    assert stock_emotion.emotion_index_label(90) == "Extreme Greed"
    assert stock_emotion.emotion_index_label(65) == "Greed"
    assert stock_emotion.emotion_index_label(50) == "Neutral"
    assert stock_emotion.emotion_index_label(30) == "Fear"
    assert stock_emotion.emotion_index_label(10) == "Extreme Fear"


def test_parse_json_response_handles_code_fences() -> None:
    assert parse_json_response('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_response('prefix text {"b": 2} trailing') == {"b": 2}


def test_parse_json_response_raises_on_garbage() -> None:
    with pytest.raises(LMStudioError):
        parse_json_response("there is no json here")


def test_analyze_stock_emotion_fallback(monkeypatch) -> None:
    monkeypatch.setattr(stock_emotion, "get_settings", lambda: _fake_settings())
    # Provider has no API key -> cloud call is skipped -> lexical fallback.
    monkeypatch.setattr(stock_emotion, "get_llm_provider", lambda: _FakeProvider(api_key=None))
    monkeypatch.setattr(stock_emotion, "score_article_sentiment", _stub_sentiment)
    articles = [
        {"title": "Company beats earnings and posts record profit", "summary": "strong growth",
         "source": "Wire", "url": "u1", "published_at": "2026-05-10"},
        {"title": "Company faces fraud probe and analyst downgrade", "summary": "loss warning",
         "source": "Wire", "url": "u2", "published_at": "2026-05-11"},
    ]
    result = asyncio.run(stock_emotion.analyze_stock_emotion("TEST", articles, period_days=7))
    assert result["engine"] == "fallback"
    assert result["articles_analyzed"] == 2
    assert 0.0 <= result["emotion_index"] <= 100.0
    assert result["sentiment_label"] in {"Bullish", "Bearish", "Neutral"}
    assert len(result["articles"]) == 2
    assert result["narrative"]


def test_analyze_stock_emotion_empty(monkeypatch) -> None:
    monkeypatch.setattr(stock_emotion, "get_settings", lambda: _fake_settings())
    monkeypatch.setattr(stock_emotion, "get_llm_provider", lambda: _FakeProvider(api_key=None))
    result = asyncio.run(stock_emotion.analyze_stock_emotion("TEST", [], period_days=7))
    assert result["articles_analyzed"] == 0
    assert result["emotion_index"] == 50.0
    assert result["emotion_index_label"] == "Neutral"


def test_analyze_stock_emotion_via_provider(monkeypatch) -> None:
    monkeypatch.setattr(stock_emotion, "get_settings", lambda: _fake_settings(provider="openrouter"))
    monkeypatch.setattr(stock_emotion, "get_llm_provider", lambda: _FakeProvider(api_key="k"))
    monkeypatch.setattr(stock_emotion, "score_article_sentiment", _stub_sentiment)
    articles = [
        {"title": "Upbeat outlook lifts shares", "summary": "", "source": "Wire",
         "url": "u1", "published_at": "2026-05-12"},
    ]
    result = asyncio.run(stock_emotion.analyze_stock_emotion("TEST", articles, period_days=7))
    assert result["engine"] == "openrouter"
    assert result["dominant_emotion"] == "optimism"
    assert result["sentiment_label"] == "Bullish"
    assert result["narrative"].startswith("TEST")
    assert "optimism" in result["narrative"]
    assert result["articles"][0]["rationale"] == "Strong quarterly results."


def test_analyze_stock_emotion_unparseable_llm_reply_falls_back(monkeypatch) -> None:
    class _GarbageProvider(_FakeProvider):
        async def complete(self, messages, tools=None, *, temperature=0.1, max_tokens=1024) -> AssistantMessage:  # noqa: ANN001
            return AssistantMessage(content="sorry, I cannot help with that")

    monkeypatch.setattr(stock_emotion, "get_settings", lambda: _fake_settings(provider="openrouter"))
    monkeypatch.setattr(stock_emotion, "get_llm_provider", lambda: _GarbageProvider(api_key="k"))
    monkeypatch.setattr(stock_emotion, "score_article_sentiment", _stub_sentiment)
    articles = [{"title": "Record profit", "summary": "", "source": "Wire", "url": "u1", "published_at": "2026-05-12"}]
    result = asyncio.run(stock_emotion.analyze_stock_emotion("TEST", articles, period_days=7))
    assert result["engine"] == "fallback"
