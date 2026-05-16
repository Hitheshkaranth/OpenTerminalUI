"""Shared LLM insight helper backed by the locally hosted Gemma model.

Several read-heavy screens (stock briefing, backtest explainer, risk insights)
need the same thing: hand the model some structured data, get back a concise,
sectioned analysis. This module centralises that so every feature uses one
LM Studio client, one schema, and one graceful-fallback path.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from backend.config.settings import get_settings
from backend.services.lm_studio_client import (
    LMStudioError,
    get_lm_studio_client,
    parse_json_response,
)

_VALID_TONES = {"positive", "negative", "neutral"}

# Unified structured-output schema shared by every insight endpoint so a single
# frontend card can render all of them.
INSIGHT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "maxLength": 600},
        "sections": {
            "type": "array",
            "minItems": 2,
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "maxLength": 48},
                    "tone": {"type": "string", "enum": ["positive", "negative", "neutral"]},
                    "points": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 5,
                        "items": {"type": "string", "maxLength": 220},
                    },
                },
                "required": ["title", "tone", "points"],
            },
        },
    },
    "required": ["summary", "sections"],
}


def current_model() -> str:
    return get_settings().lm_studio_model


def _sanitize_sections(raw: Any) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    if not isinstance(raw, list):
        return sections
    for node in raw:
        if not isinstance(node, dict):
            continue
        title = str(node.get("title") or "").strip()[:64]
        tone = str(node.get("tone") or "neutral").strip().lower()
        if tone not in _VALID_TONES:
            tone = "neutral"
        points_raw = node.get("points")
        points = [
            str(p).strip()[:240]
            for p in (points_raw if isinstance(points_raw, list) else [])
            if str(p).strip()
        ]
        if title and points:
            sections.append({"title": title, "tone": tone, "points": points[:5]})
    return sections[:4]


async def run_insight(
    system_prompt: str,
    user_content: str,
    *,
    max_tokens: int = 900,
    unavailable_summary: str = "AI analysis is unavailable — start LM Studio with a Gemma model to enable it.",
) -> dict[str, Any]:
    """Produce a `{summary, sections}` insight, falling back gracefully.

    Returns ``engine: "lmstudio"`` when the model answered, ``"unavailable"``
    when LM Studio is off/unreachable or the response could not be used.
    """
    settings = get_settings()
    model = settings.lm_studio_model
    generated_at = datetime.now(timezone.utc).isoformat()
    base = {
        "engine": "unavailable",
        "model": model,
        "summary": unavailable_summary,
        "sections": [],
        "generated_at": generated_at,
    }

    client = get_lm_studio_client()
    if not settings.lm_studio_enabled or not await client.health():
        return base

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    try:
        content = await client.chat(
            messages,
            temperature=0.3,
            max_tokens=max_tokens,
            json_schema=INSIGHT_SCHEMA,
            frequency_penalty=0.3,
        )
        parsed = parse_json_response(content)
    except (LMStudioError, asyncio.TimeoutError):
        return base

    summary = str(parsed.get("summary") or "").strip()
    sections = _sanitize_sections(parsed.get("sections"))
    if not summary and not sections:
        return base
    return {
        "engine": "lmstudio",
        "model": model,
        "summary": summary,
        "sections": sections,
        "generated_at": generated_at,
    }
