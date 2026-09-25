"""Per-stock news emotion analysis backed by a configurable LLM provider.

Each recent news item for a ticker is scored for both financial sentiment and
the market *emotion* it conveys by whichever agent LLM provider is configured
(OpenRouter by default; LM Studio or OpenAI-compatible endpoints are selectable
via ``agent_provider``). The per-article results are aggregated into an emotion
index (a 0-100 fear<->greed scale), a dominant emotion, an emotion distribution
and a short narrative.

When no provider is reachable the module degrades gracefully to the existing
lexical sentiment engine so the endpoint always returns a usable payload.
"""

from __future__ import annotations

import asyncio
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from backend.config.settings import get_settings
from backend.services.llm.base import LLMError, LLMMessage
from backend.services.llm.factory import get_llm_provider
from backend.services.lm_studio_client import LMStudioError, parse_json_response
from backend.services.sentiment_engine import score_article_sentiment

# Emotion taxonomy mapped onto a 0-100 fear<->greed axis.
EMOTION_AXIS: dict[str, int] = {
    "euphoria": 100,
    "optimism": 82,
    "confidence": 66,
    "neutral": 50,
    "uncertainty": 44,
    "caution": 36,
    "anxiety": 24,
    "fear": 12,
    "panic": 2,
}
EMOTIONS: list[str] = list(EMOTION_AXIS.keys())

_SENTIMENT_LABELS = {"Bullish", "Bearish", "Neutral"}

_SYSTEM_PROMPT = (
    "You are a financial sentiment and emotion analyst. You read a single news "
    "headline and summary about a publicly traded company and judge both the "
    "investment sentiment and the dominant market emotion it conveys. "
    "Respond ONLY with a compact JSON object, no prose, no code fences."
)

# LM Studio structured-output schema for a single article analysis.
_ANALYSIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "sentiment_score": {"type": "number"},
        "sentiment_label": {"type": "string", "enum": ["Bullish", "Bearish", "Neutral"]},
        "confidence": {"type": "number"},
        "emotion": {"type": "string", "enum": EMOTIONS},
        "emotion_intensity": {"type": "number"},
        "rationale": {"type": "string", "maxLength": 120},
    },
    "required": [
        "sentiment_score",
        "sentiment_label",
        "confidence",
        "emotion",
        "emotion_intensity",
        "rationale",
    ],
}


def _batch_schema(count: int) -> dict[str, Any]:
    """Build a batched schema that forces exactly one analysis per article.

    minItems/maxItems are essential: without them some local models close the
    ``analyses`` array empty even though the prompt asks for N entries.
    """
    return {
        "type": "object",
        "properties": {
            "analyses": {
                "type": "array",
                "minItems": count,
                "maxItems": count,
                "items": _ANALYSIS_SCHEMA,
            },
        },
        "required": ["analyses"],
    }


def emotion_index_label(index: float) -> str:
    """Bucket a 0-100 emotion index into a human-readable label."""
    if index >= 80:
        return "Extreme Greed"
    if index >= 60:
        return "Greed"
    if index > 40:
        return "Neutral"
    if index > 20:
        return "Fear"
    return "Extreme Fear"


def _sentiment_label_from_score(score: float) -> str:
    if score > 0.1:
        return "Bullish"
    if score < -0.1:
        return "Bearish"
    return "Neutral"


def _emotion_from_score(score: float) -> str:
    if score >= 0.6:
        return "optimism"
    if score >= 0.2:
        return "confidence"
    if score > -0.2:
        return "neutral"
    if score > -0.6:
        return "anxiety"
    return "fear"


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _build_batch_prompt(ticker: str, numbered_articles: list[str]) -> str:
    body = "\n".join(numbered_articles)
    return (
        f"Company / ticker: {ticker}\n\n"
        f"Analyze each of the following {len(numbered_articles)} news items:\n\n"
        f"{body}\n\n"
        'Return a JSON object {"analyses": [ ... ]} containing exactly one '
        "analysis object per news item, in the same order. Each object has:\n"
        '  "sentiment_score": number from -1.0 (very bearish) to 1.0 (very bullish)\n'
        '  "sentiment_label": one of "Bullish", "Bearish", "Neutral"\n'
        '  "confidence": number from 0.0 to 1.0\n'
        f'  "emotion": one of {EMOTIONS}\n'
        '  "emotion_intensity": number from 0.0 (mild) to 1.0 (intense)\n'
        '  "rationale": one short sentence explaining the judgement'
    )


def _compose_text(title: str, summary: str) -> str:
    return f"{title or ''}. {summary or ''}".strip()


def _clean_rationale(text: str) -> str:
    """Drop degenerate model rationale (repetition loops, symbol soup)."""
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    words = [w for w in re.split(r"[\s\-]+", cleaned.lower()) if w]
    if len(words) < 3:
        return ""
    # Reject repetition loops: few distinct words, or a word repeating heavily.
    if len(set(words)) / len(words) < 0.6:
        return ""
    if Counter(words).most_common(1)[0][1] >= 3:
        return ""
    # Reject output that is mostly punctuation / non-letters.
    letters = sum(ch.isalpha() for ch in cleaned)
    if letters < len(cleaned) * 0.55:
        return ""
    return cleaned[:200]


def _sanitize_analysis(raw: dict[str, Any], fallback_score: float) -> dict[str, Any]:
    score = _clamp(_coerce_float(raw.get("sentiment_score"), fallback_score), -1.0, 1.0)
    label = str(raw.get("sentiment_label") or "").strip().title()
    if label not in _SENTIMENT_LABELS:
        label = _sentiment_label_from_score(score)
    confidence = _clamp(_coerce_float(raw.get("confidence"), 0.5), 0.0, 1.0)
    emotion = str(raw.get("emotion") or "").strip().lower()
    if emotion not in EMOTION_AXIS:
        emotion = _emotion_from_score(score)
    intensity = _clamp(_coerce_float(raw.get("emotion_intensity"), abs(score)), 0.0, 1.0)
    rationale = _clean_rationale(str(raw.get("rationale") or ""))
    return {
        "sentiment_score": round(score, 4),
        "sentiment_label": label,
        "confidence": round(confidence, 4),
        "emotion": emotion,
        "emotion_intensity": round(intensity, 4),
        "rationale": rationale,
    }


def _fallback_analysis(title: str, summary: str) -> dict[str, Any]:
    scored = score_article_sentiment(_compose_text(title, summary))
    score = _clamp(_coerce_float(scored.get("score"), 0.0), -1.0, 1.0)
    label = str(scored.get("label") or _sentiment_label_from_score(score))
    if label not in _SENTIMENT_LABELS:
        label = _sentiment_label_from_score(score)
    confidence = _clamp(_coerce_float(scored.get("confidence"), 0.4), 0.0, 1.0)
    return {
        "sentiment_score": round(score, 4),
        "sentiment_label": label,
        "confidence": round(confidence, 4),
        "emotion": _emotion_from_score(score),
        "emotion_intensity": round(abs(score), 4),
        "rationale": "Lexical fallback (LM Studio unavailable).",
    }


async def _analyze_batch(
    provider: Any, ticker: str, articles: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Analyze every article in a single LLM call; returns the raw analyses."""
    numbered: list[str] = []
    for idx, article in enumerate(articles, start=1):
        title = str(article.get("title") or "").strip()
        summary = str(article.get("summary") or "").strip()
        numbered.append(
            f"{idx}. Headline: {title}\n   Summary: {summary or '(no summary provided)'}"
        )
    messages = [
        LLMMessage(role="system", content=_SYSTEM_PROMPT),
        LLMMessage(role="user", content=_build_batch_prompt(ticker, numbered)),
    ]
    max_tokens = min(3000, 120 * len(articles) + 256)
    result = await provider.complete(messages, temperature=0.2, max_tokens=max_tokens)
    parsed = parse_json_response(result.content or "")
    analyses = parsed.get("analyses")
    if not isinstance(analyses, list):
        raise LLMError("LLM batch response missing 'analyses' array")
    return analyses


def _templated_narrative(ticker: str, stats: dict[str, Any]) -> str:
    return (
        f"{ticker} news flow reads as {stats['emotion_index_label'].lower()} "
        f"(emotion index {stats['emotion_index']}/100), with {stats['dominant_emotion']} "
        f"the dominant emotion across {stats['articles_analyzed']} recent articles. "
        f"Average sentiment is {stats['sentiment_label'].lower()} "
        f"({stats['sentiment_score']:+.2f})."
    )


def _aggregate(
    ticker: str,
    period_days: int,
    engine: str,
    model: str,
    analyzed: list[dict[str, Any]],
) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc).isoformat()
    if not analyzed:
        return {
            "ticker": ticker,
            "engine": engine,
            "model": model,
            "period_days": period_days,
            "articles_analyzed": 0,
            "emotion_index": 50.0,
            "emotion_index_label": "Neutral",
            "dominant_emotion": "neutral",
            "sentiment_score": 0.0,
            "sentiment_label": "Neutral",
            "confidence": 0.0,
            "emotion_distribution": [],
            "narrative": f"No recent news found for {ticker} in the last {period_days} days.",
            "articles": [],
            "generated_at": generated_at,
        }

    weight_total = 0.0
    index_acc = 0.0
    score_acc = 0.0
    conf_acc = 0.0
    emotion_weight: dict[str, float] = {}
    emotion_count: dict[str, int] = {}

    for item in analyzed:
        weight = max(0.1, float(item["confidence"]))
        weight_total += weight
        index_acc += EMOTION_AXIS[item["emotion"]] * weight
        score_acc += float(item["sentiment_score"]) * weight
        conf_acc += float(item["confidence"])
        emotion_weight[item["emotion"]] = (
            emotion_weight.get(item["emotion"], 0.0)
            + weight * (0.4 + 0.6 * float(item["emotion_intensity"]))
        )
        emotion_count[item["emotion"]] = emotion_count.get(item["emotion"], 0) + 1

    count = len(analyzed)
    emotion_index = round(index_acc / weight_total, 1) if weight_total else 50.0
    sentiment_score = round(score_acc / weight_total, 4) if weight_total else 0.0
    confidence = round(conf_acc / count, 4)
    dominant_emotion = max(emotion_weight.items(), key=lambda kv: kv[1])[0]
    distribution = sorted(
        (
            {
                "emotion": emotion,
                "count": cnt,
                "share": round(cnt / count, 4),
            }
            for emotion, cnt in emotion_count.items()
        ),
        key=lambda row: row["count"],
        reverse=True,
    )

    return {
        "ticker": ticker,
        "engine": engine,
        "model": model,
        "period_days": period_days,
        "articles_analyzed": count,
        "emotion_index": emotion_index,
        "emotion_index_label": emotion_index_label(emotion_index),
        "dominant_emotion": dominant_emotion,
        "sentiment_score": sentiment_score,
        "sentiment_label": _sentiment_label_from_score(sentiment_score),
        "confidence": confidence,
        "emotion_distribution": distribution,
        "narrative": "",
        "articles": [],
        "generated_at": generated_at,
    }


async def analyze_stock_emotion(
    ticker: str,
    articles: list[dict[str, Any]],
    *,
    period_days: int = 7,
    limit: int = 6,
) -> dict[str, Any]:
    """Analyze recent news for a ticker and return an aggregated emotion profile."""
    symbol = ticker.strip().upper()
    settings = get_settings()
    provider_name = (settings.agent_provider or "openrouter").lower()

    selected = [a for a in (articles or []) if str(a.get("title") or "").strip()][:limit]

    # Build the configured agent provider (OpenRouter / OpenAI / LM Studio).
    provider = None
    try:
        provider = get_llm_provider()
    except Exception:
        provider = None
    model = getattr(provider, "model", None) or settings.agent_model

    if not selected:
        return _aggregate(symbol, period_days, "fallback", model, [])

    engine = "fallback"
    analyzed: list[dict[str, Any]] = []

    # Cloud providers need an API key; LM Studio is keyless/local. Skip the call
    # (use lexical fallback) when no usable provider is configured.
    can_try = provider is not None and (bool(getattr(provider, "api_key", None)) or provider_name == "lmstudio")
    raw_analyses: list[Any] = []
    if can_try:
        try:
            raw_analyses = await _analyze_batch(provider, symbol, selected)
            engine = provider_name
        except (LLMError, LMStudioError, asyncio.TimeoutError):
            raw_analyses = []
            engine = "fallback"

    for idx, article in enumerate(selected):
        title = str(article.get("title") or "")
        summary = str(article.get("summary") or "")
        raw = raw_analyses[idx] if idx < len(raw_analyses) else None
        if engine != "fallback" and isinstance(raw, dict):
            fallback_score = _coerce_float(
                (score_article_sentiment(_compose_text(title, summary)) or {}).get("score"), 0.0
            )
            analyzed.append(_sanitize_analysis(raw, fallback_score))
        else:
            analyzed.append(_fallback_analysis(title, summary))

    # If the model returned too few usable entries, mark the run as fallback.
    if engine != "fallback":
        llm_hits = sum(1 for r in analyzed if "Lexical fallback" not in r["rationale"])
        if llm_hits < max(1, len(analyzed) // 2):
            engine = "fallback"

    payload = _aggregate(symbol, period_days, engine, model, analyzed)

    payload["articles"] = [
        {
            "title": str(article.get("title") or "").strip(),
            "source": str(article.get("source") or "Unknown").strip() or "Unknown",
            "url": str(article.get("url") or "").strip(),
            "published_at": str(article.get("published_at") or "").strip(),
            **result,
        }
        for article, result in zip(selected, analyzed)
    ]

    payload["narrative"] = _templated_narrative(symbol, payload)
    return payload
