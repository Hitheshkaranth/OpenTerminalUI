from __future__ import annotations

import re
from typing import Any

from backend.config.settings import get_settings
from backend.services.lm_studio_client import LMStudioError, parse_json_response
from backend.services.llm.base import LLMMessage
from backend.services.llm.factory import get_llm_provider

_WHITESPACE_RE = re.compile(r"\s+")
_LEADING_TRAILING_RE = re.compile(r"^\s+|\s+$")


def _normalize(text: str) -> str:
    """Lower-case, collapse whitespace, and drop apostrophes/quotes so that a
    quote reconstructed by the model still matches the stored source text."""
    text = (text or "").lower()
    text = _LEADING_TRAILING_RE.sub("", text)
    text = _WHITESPACE_RE.sub(" ", text)
    return text.replace("\u2019", "'").replace("\u2018", "'")


def llm_available() -> bool:
    """True when the configured provider can actually reach an endpoint.

    OpenRouter needs an API key; LM Studio needs a resolvable base URL. Any
    other configured provider without credentials is treated as unavailable so
    callers fall back to the lexical extractor.
    """
    settings = get_settings()
    provider = (settings.agent_provider or "openrouter").lower()
    if provider == "openrouter":
        return bool(settings.openrouter_api_key)
    if provider == "lmstudio":
        return bool((settings.lm_studio_base_url or "").strip()) and not settings.lm_studio_base_url.startswith(
            "http://localhost:1234/v1"
        )
    # openai / gemini rely on their own keys; consider any non-empty key available.
    key = getattr(settings, f"{provider}_api_key", None)
    return bool(key)


# Reason for the most recent failed call (e.g. "model unavailable", HTTP 429), so callers can tell the
# user why results fell back to keyword matching instead of failing silently.
last_error: str | None = None


async def complete_json(system: str, user: str, *, max_tokens: int = 2500) -> dict[str, Any] | None:
    """Ask the configured LLM for a JSON object, or return None on any failure.

    Building the provider or completing the request may fail when no API key /
    base URL is configured; in every such case (and when the response cannot be
    parsed as JSON) we return None so callers transparently fall back to lexical.
    """
    global last_error
    try:
        provider = get_llm_provider()
        if not llm_available():
            last_error = "no AI model configured"
            return None
        assistant = await provider.complete(
            [
                LLMMessage(role="system", content=system),
                LLMMessage(role="user", content=user),
            ],
            max_tokens=max_tokens,
            temperature=0.1,
            # JSON extraction: a reasoning model (e.g. Ornith) otherwise spends the whole budget
            # thinking and returns no answer (finish_reason=length).
            disable_thinking=True,
        )
        parsed = parse_json_response(assistant.content or "")
        last_error = None
        return parsed
    except Exception as exc:  # noqa: BLE001 - every failure degrades to the lexical path
        last_error = f"{type(exc).__name__}: {str(exc)[:200]}"
        return None


_TOKEN_RE = re.compile(r"[a-z0-9]+(?:[.,][0-9]+)*%?|[₹$€£]")
_NUMERIC_RE = re.compile(r"\d")
_MIN_FUZZY_TOKENS = 6


def _tokens(text: str) -> list[str]:
    # Punctuation-insensitive tokens; numbers keep their separators ("45,000", "12.5%").
    return _TOKEN_RE.findall(_normalize(text))


def verify_quote(quote: str, text: str) -> bool:
    """True when ``quote`` appears (verbatim-ish) in ``text``.

    Accepts an exact normalised-substring match, or — for quotes of at least
    _MIN_FUZZY_TOKENS words — a contiguous window of the text where ≥ 85% of the
    quote's tokens appear AND every numeric token of the quote appears verbatim.
    The numeric rule is what stops a model from passing off a changed figure
    ("₹45,000 crore" when the filing says "₹40,000 crore") as a verified quote.
    """
    q = _normalize(quote)
    t = _normalize(text)
    if not q or not t:
        return False
    if q in t:
        return True

    q_tokens = _tokens(q)
    t_tokens = _tokens(t)
    if len(q_tokens) < _MIN_FUZZY_TOKENS or len(t_tokens) < len(q_tokens):
        return False
    numbers = [tk for tk in q_tokens if _NUMERIC_RE.search(tk)]
    window = len(q_tokens)
    for start in range(len(t_tokens) - window + 1):
        window_tokens = t_tokens[start:start + window]
        window_set = set(window_tokens)
        if any(n not in window_set for n in numbers):
            continue
        matched = sum(1 for tk in q_tokens if tk in window_set)
        if matched / len(q_tokens) >= 0.85:
            return True
    return False


def citation_for(chunk: dict[str, Any], quote: str) -> dict[str, Any]:
    """Build a Citation-shaped dict; the quote is trimmed to 400 chars."""
    return {
        "doc_id": chunk.get("document_id"),
        "title": chunk.get("title"),
        "page_start": chunk.get("page_start"),
        "page_end": chunk.get("page_end"),
        "section": chunk.get("section"),
        "quote": _clean_quote(quote),
        "source_url": chunk.get("source_url"),
    }


def _clean_quote(quote: str) -> str:
    text = " ".join((quote or "").split())
    return text[:400]