from __future__ import annotations

import asyncio
import json
import re
from typing import Any

import httpx

# Harmony/control tokens that reasoning models (e.g. gpt-oss) sometimes leak into
# message content, e.g. "<|channel|>commentary". Strip them so they never reach
# the UI as part of the answer.
_HARMONY_TOKEN_RE = re.compile(r"<\|[^|>]*\|>")
# A leading channel marker like "commentary"/"analysis"/"final" left behind after
# the control tokens are removed.
_CHANNEL_LEAD_RE = re.compile(r"^\s*(?:commentary|analysis|final)\b[:.]?\s*", re.IGNORECASE)


def _clean_content(content: str | None) -> str | None:
    if not content:
        return content
    cleaned = _HARMONY_TOKEN_RE.sub("", content)
    cleaned = _CHANNEL_LEAD_RE.sub("", cleaned)
    return cleaned.strip() or content

from backend.services.llm.base import (
    AssistantMessage, LLMError, LLMMessage, ToolCall, ToolDef,
)


class OpenAICompatibleProvider:
    """Async client for any OpenAI-compatible /chat/completions endpoint."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        model: str,
        timeout: float = 120.0,
        extra_headers: dict[str, str] | None = None,
        transport: httpx.BaseTransport | None = None,
        fallback_models: list[str] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.extra_headers = extra_headers or {}
        self._transport = transport  # injected in tests
        self.fallback_models = fallback_models or []

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", **self.extra_headers}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def complete(
        self,
        messages: list[LLMMessage | AssistantMessage],
        tools: list[ToolDef] | None = None,
        *,
        temperature: float = 0.1,
        max_tokens: int = 1024,
    ) -> AssistantMessage:
        payload: dict[str, Any] = {
            "messages": [m.to_wire() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if tools:
            payload["tools"] = [t.to_wire() for t in tools]
            payload["tool_choice"] = "auto"
        url = f"{self.base_url}/chat/completions"

        # Try the primary model, then any fallbacks (free models are flaky:
        # 429 = rate-limited, 404 = unavailable). Each model gets a short
        # retry/backoff for transient 429/5xx before moving to the next.
        candidates = [self.model] + [m for m in self.fallback_models if m != self.model]
        last_exc: Exception | None = None
        for model in candidates:
            payload["model"] = model
            for attempt in range(3):
                try:
                    async with httpx.AsyncClient(
                        timeout=self.timeout, trust_env=False, transport=self._transport
                    ) as client:
                        resp = await client.post(url, json=payload, headers=self._headers())
                        resp.raise_for_status()
                        return self._parse(resp.json())
                except httpx.HTTPStatusError as exc:
                    status = exc.response.status_code if exc.response is not None else 0
                    last_exc = LLMError(f"LLM HTTP {status}")
                    if status == 401:
                        raise last_exc from exc  # bad key — no point trying other models
                    if status in (429, 500, 502, 503, 504) and attempt < 2:
                        await asyncio.sleep(1.5 * (attempt + 1))
                        continue
                    break  # 404/other -> move on to the next candidate model
                except (httpx.HTTPError, ValueError) as exc:
                    last_exc = LLMError(f"LLM request failed: {exc}")
                    if attempt < 2:
                        await asyncio.sleep(1.0 * (attempt + 1))
                        continue
                    break
        raise last_exc or LLMError("LLM request failed")

    @staticmethod
    def _parse(data: dict[str, Any]) -> AssistantMessage:
        try:
            message = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError("LLM returned an unexpected payload") from exc
        raw_calls = message.get("tool_calls") or []
        calls: list[ToolCall] = []
        for rc in raw_calls:
            fn = rc.get("function", {})
            raw_args = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
            except json.JSONDecodeError:
                args = {}
            calls.append(ToolCall(id=rc.get("id", ""), name=fn.get("name", ""), arguments=args))
        content = message.get("content")
        # Reasoning models (e.g. gpt-oss) sometimes return their text in a
        # `reasoning` field with `content` null (notably when finish_reason=length).
        # Fall back to it so non-tool turns don't surface as empty responses.
        if not (content or "").strip() and not calls:
            content = message.get("reasoning") or content
        return AssistantMessage(content=_clean_content(content), tool_calls=calls)
