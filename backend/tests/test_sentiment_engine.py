from __future__ import annotations

from backend.services import sentiment_engine
from backend.services.sentiment_engine import SentimentEngine


def test_sentiment_engine_finbert_primary(monkeypatch) -> None:
    engine = SentimentEngine()

    def _fake_finbert(_: str):
        return [{"label": "positive", "score": 0.91}]

    monkeypatch.setattr(engine, "_lazy_finbert", lambda: _fake_finbert)

    out = engine.score("Company posts strong beat with demand growth.")
    assert out["label"] == "Bullish"
    assert out["score"] == 0.91
    assert out["confidence"] == 0.91


def test_sentiment_engine_textblob_fallback_when_finbert_unavailable(monkeypatch) -> None:
    engine = SentimentEngine()
    monkeypatch.setattr(engine, "_lazy_finbert", lambda: None)

    class _FakeBlobSentiment:
        polarity = -0.3

    class _FakeBlob:
        def __init__(self, _: str) -> None:
            self.sentiment = _FakeBlobSentiment()

    monkeypatch.setattr(sentiment_engine, "TextBlob", _FakeBlob)

    out = engine.score("Guidance cut and weak outlook for demand.")
    assert out["label"] == "Bearish"
    assert out["score"] < 0.0
    assert out["confidence"] > 0.0
