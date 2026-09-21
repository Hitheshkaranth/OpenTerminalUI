from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Awaitable, Callable

import httpx

# Async callback used to surface transient progress (model attempts, rate-limit
# backoffs) to the agent event stream while a single completion is in flight.
StatusCallback = Callable[[str], Awaitable[None]]

# Harmony/control tokens that reasoning models (e.g. gpt-oss) sometimes leak into
# message content, e.g. "<|channel|>commentary". Strip them so they never reach
# the UI as part of the answer.
_HARMONY_TOKEN_RE = re.compile(r"<\|[^|>]*\|>")
# A leading channel marker like "commentary"/"analysis"/"final" left behind after
# the control tokens are removed.
_CHANNEL_LEAD_RE = re.compile(r"^\s*(?:commentary|analysis|final)\b[:.]?\s*", re.IGNORECASE)


def _short_model(model: str) -> str:
    """Human-friendly model label for status notes: drop the provider prefix and
    the ':free' suffix, e.g. 'meta-llama/llama-3.3-70b-instruct:free' -> 'llama-3.3-70b-instruct'."""
    name = model.split("/")[-1]
    return name.removesuffix(":free")


# Qwen/Hermes-style models sometimes emit a tool call as literal text instead of a
# structured call; never show that scaffolding to the user.
_LEAKED_TOOL_CALL_RE = re.compile(r"<tool_call>.*?</tool_call>|<tool_call>.*$|<function=[^>]*>.*?</function>", re.DOTALL)


def _clean_content(content: str | None) -> str | None:
    if not content:
        return content
    cleaned = _HARMONY_TOKEN_RE.sub("", content)
    cleaned = _CHANNEL_LEAD_RE.sub("", cleaned)
    cleaned = _LEAKED_TOOL_CALL_RE.sub("", cleaned)
    return cleaned.strip() or None

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
        honor_model_chain: bool = True,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        # A single-model local server (LM Studio / vLLM) ignores routed model chains.
        self.honor_model_chain = honor_model_chain
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

    def _is_local_server(self) -> bool:
        host = self.base_url.lower()
        return not any(h in host for h in ("openrouter.ai", "api.openai.com", "generativelanguage.googleapis.com"))

    async def complete(
        self,
        messages: list[LLMMessage | AssistantMessage],
        tools: list[ToolDef] | None = None,
        *,
        temperature: float = 0.1,
        max_tokens: int = 1024,
        models: list[str] | None = None,
        on_status: StatusCallback | None = None,
        disable_thinking: bool = False,
    ) -> AssistantMessage:
        payload: dict[str, Any] = {
            "messages": [m.to_wire() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if disable_thinking and self._is_local_server():
            # Structured (JSON-only) calls: a reasoning model that spends the budget
            # thinking returns no answer. vLLM / LM Studio honour this template flag;
            # hosted APIs would reject the unknown field, so it is never sent there.
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        if tools:
            payload["tools"] = [t.to_wire() for t in tools]
            payload["tool_choice"] = "auto"
        url = f"{self.base_url}/chat/completions"

        # Try the primary model, then any fallbacks (free models are flaky:
        # 429 = rate-limited, 404 = unavailable). Each model gets a short
        # retry/backoff for transient 429/5xx before moving to the next.
        # Routed model chains (`:free` OpenRouter ids from model_router) only make sense on
        # OpenRouter. A local LM Studio / vLLM / OpenAI endpoint serves its own configured
        # model, so ignore the chain there instead of 404-ing on a foreign model id.
        if models is not None and not self.honor_model_chain:
            models = None
        candidates = models if models is not None else [self.model] + [m for m in self.fallback_models if m != self.model]

        async def notify(text: str) -> None:
            if on_status is not None:
                try:
                    await on_status(text)
                except Exception:  # status reporting must never break a completion
                    pass

        last_exc: Exception | None = None
        total = len(candidates)
        for ci, model in enumerate(candidates):
            payload["model"] = model
            short = _short_model(model)
            await notify(
                f"Contacting {short}…" if ci == 0 else f"Falling back to {short}…"
            )
            for attempt in range(3):
                try:
                    async with httpx.AsyncClient(
                        timeout=self.timeout, trust_env=False, transport=self._transport
                    ) as client:
                        resp = await client.post(url, json=payload, headers=self._headers())
                        resp.raise_for_status()
                        return self._parse(resp.json(), model=model)
                except httpx.HTTPStatusError as exc:
                    status = exc.response.status_code if exc.response is not None else 0
                    # Keep a slice of the body: 4xx from a local server usually says exactly
                    # what was wrong (bad role order, unknown param, context length…).
                    detail = ""
                    try:
                        detail = (exc.response.text or "")[:240].replace("\n", " ") if exc.response is not None else ""
                    except Exception:
                        detail = ""
                    last_exc = LLMError(f"LLM HTTP {status}" + (f": {detail}" if detail else ""))
                    if status == 401:
                        raise last_exc from exc  # bad key — no point trying other models
                    if status in (429, 500, 502, 503, 504) and attempt < 2:
                        # Gemini free tier has strict RPM limits; wait longer on 429
                        wait_time = 15.0 if status == 429 else 1.5 * (attempt + 1)
                        reason = "rate-limited" if status == 429 else f"error {status}"
                        await notify(f"{short} {reason}; retrying in {int(wait_time)}s…")
                        await asyncio.sleep(wait_time)
                        continue
                    if ci < total - 1:
                        await notify(f"{short} unavailable (HTTP {status}); trying next model…")
                    break  # 404/other -> move on to the next candidate model
                except (httpx.HTTPError, ValueError) as exc:
                    last_exc = LLMError(f"LLM request failed: {exc}")
                    if attempt < 2:
                        await notify(f"{short} connection issue; retrying…")
                        await asyncio.sleep(1.0 * (attempt + 1))
                        continue
                    break
        raise last_exc or LLMError("LLM request failed")

    @staticmethod
    def _parse(data: dict[str, Any], *, model: str | None = None) -> AssistantMessage:
        if not isinstance(data, dict):
            raise LLMError("LLM returned a non-object payload")

        provider_error = data.get("error")
        if provider_error:
            if isinstance(provider_error, dict):
                detail = provider_error.get("message") or provider_error.get("error") or provider_error.get("code")
            else:
                detail = provider_error
            raise LLMError(f"LLM returned an error payload: {detail or 'unknown error'}")

        message: dict[str, Any] | None = None
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            choice = choices[0]
            if isinstance(choice, dict):
                raw_message = choice.get("message")
                if isinstance(raw_message, dict):
                    message = raw_message
                elif isinstance(choice.get("text"), str):
                    message = {"content": choice["text"]}
                elif isinstance(choice.get("delta"), dict):
                    message = choice["delta"]

        if message is None:
            message = OpenAICompatibleProvider._parse_gemini_candidate(data)
        if message is None:
            keys = ", ".join(sorted(str(k) for k in data.keys())) or "none"
            raise LLMError(f"LLM returned an unexpected payload shape (keys: {keys})")

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
        return AssistantMessage(content=_clean_content(content), tool_calls=calls, model=model)

    @staticmethod
    def _parse_gemini_candidate(data: dict[str, Any]) -> dict[str, Any] | None:
        """Accept Gemini native response bodies when a proxy returns them.

        The configured Gemini provider uses the OpenAI-compatible endpoint, but
        gateways and local shims sometimes return the native shape:
        ``{"candidates": [{"content": {"parts": [{"text": "..."}]}}]}``.
        Treat text parts as assistant content and functionCall parts as tool
        calls so the agent can continue instead of failing with a generic parse
        error.
        """
        candidates = data.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            return None
        candidate = candidates[0]
        if not isinstance(candidate, dict):
            return None
        content = candidate.get("content")
        if not isinstance(content, dict):
            return None
        parts = content.get("parts")
        if not isinstance(parts, list):
            return None

        text_parts: list[str] = []
        tool_calls: list[dict[str, Any]] = []
        for index, part in enumerate(parts):
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if isinstance(text, str):
                text_parts.append(text)
                continue
            function_call = part.get("functionCall") or part.get("function_call")
            if isinstance(function_call, dict):
                name = function_call.get("name")
                if not isinstance(name, str) or not name:
                    continue
                args = function_call.get("args") or function_call.get("arguments") or {}
                tool_calls.append({
                    "id": f"gemini_call_{index}",
                    "type": "function",
                    "function": {"name": name, "arguments": args},
                })

        if not text_parts and not tool_calls:
            return None
        return {
            "content": "\n".join(part.strip() for part in text_parts if part.strip()) or None,
            "tool_calls": tool_calls,
        }
