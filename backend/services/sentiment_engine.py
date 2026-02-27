from __future__ import annotations

from functools import lru_cache
from typing import Any

try:
    from textblob import TextBlob  # type: ignore
except Exception:  # pragma: no cover
    TextBlob = None  # type: ignore


POS_TERMS = {"beat", "beats", "upgrade", "growth", "surge", "record", "strong", "outperform", "buyback", "profit"}
NEG_TERMS = {"miss", "downgrade", "fall", "drop", "weak", "lawsuit", "probe", "fraud", "loss", "warning"}


class SentimentEngine:
    def __init__(self) -> None:
        self._finbert = None
        self._tried_finbert = False

    def _lazy_finbert(self):
        if self._tried_finbert:
            return self._finbert
        self._tried_finbert = True
        try:
            from transformers import pipeline  # type: ignore

            self._finbert = pipeline("text-classification", model="ProsusAI/finbert")
        except Exception:
            self._finbert = None
        return self._finbert

    def score(self, text: str) -> dict[str, Any]:
        payload = self._score_finbert(text)
        if payload:
            return payload
        payload = self._score_textblob(text)
        if payload:
            return payload
        return self._score_lexical(text)

    def _score_finbert(self, text: str) -> dict[str, Any] | None:
        model = self._lazy_finbert()
        if model is None or not text.strip():
            return None
        try:
            result = model(text[:2000])[0]
            label_raw = str(result.get("label", "neutral")).lower()
            conf = float(result.get("score", 0.0))
            if "positive" in label_raw:
                score = conf
                label = "Bullish"
            elif "negative" in label_raw:
                score = -conf
                label = "Bearish"
            else:
                score = 0.0
                label = "Neutral"
            return {"score": round(score, 4), "label": label, "confidence": round(conf, 4)}
        except Exception:
            return None

    def _score_textblob(self, text: str) -> dict[str, Any] | None:
        if TextBlob is None or not text.strip():
            return None
        try:
            polarity = float(TextBlob(text[:4000]).sentiment.polarity)
            adjusted = polarity
            lower = text.lower()
            for term in POS_TERMS:
                if term in lower:
                    adjusted += 0.03
            for term in NEG_TERMS:
                if term in lower:
                    adjusted -= 0.03
            adjusted = max(-1.0, min(1.0, adjusted))
            if adjusted > 0.1:
                label = "Bullish"
            elif adjusted < -0.1:
                label = "Bearish"
            else:
                label = "Neutral"
            return {"score": round(adjusted, 4), "label": label, "confidence": round(min(1.0, abs(adjusted) + 0.15), 4)}
        except Exception:
            return None

    def _score_lexical(self, text: str) -> dict[str, Any]:
        lower = text.lower()
        pos = sum(1 for t in POS_TERMS if t in lower)
        neg = sum(1 for t in NEG_TERMS if t in lower)
        total = max(1, pos + neg)
        score = (pos - neg) / total
        if score > 0.1:
            label = "Bullish"
        elif score < -0.1:
            label = "Bearish"
        else:
            label = "Neutral"
        return {"score": round(score, 4), "label": label, "confidence": round(min(1.0, abs(score) + 0.2), 4)}


@lru_cache(maxsize=1)
def get_sentiment_engine() -> SentimentEngine:
    return SentimentEngine()


def score_article_sentiment(text: str) -> dict[str, Any]:
    return get_sentiment_engine().score(text or "")
