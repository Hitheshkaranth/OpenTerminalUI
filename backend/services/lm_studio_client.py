"""Async client for an LM Studio server.

LM Studio exposes an OpenAI-compatible REST API (``/v1/chat/completions``) while
serving a locally hosted model such as Google's Gemma. The terminal uses it for
news sentiment and emotion analysis so that no data leaves the user's machine.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from backend.config.settings import get_settings

_JSON_OBJ_RE = re.compile(r"\{.*\}", re.DOTALL)


class LMStudioError(RuntimeError):
    """Raised when the LM Studio endpoint is unreachable or returns bad data."""


class LMStudioClient:
    """Thin async wrapper around an LM Studio (OpenAI-compatible) endpoint."""

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.lm_studio_base_url).rstrip("/")
        self.model = model or settings.lm_studio_model
        self.timeout = float(timeout or settings.lm_studio_timeout_seconds)
        # Key-protected OpenAI-compatible gateways (vLLM / LiteLLM) reject unauthenticated calls;
        # without this header health() failed and every insight reported "unavailable".
        key = getattr(settings, "lm_studio_api_key", "") or ""
        self._headers = {"Authorization": f"Bearer {key}"} if key else {}

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.1,
        max_tokens: int = 512,
        json_schema: dict[str, Any] | None = None,
        frequency_penalty: float = 0.0,
        disable_thinking: bool = True,
    ) -> str:
        """Send a chat completion request and return the assistant message text.

        When ``json_schema`` is supplied the request uses LM Studio's structured
        output so the model is constrained to return matching JSON.
        """
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if frequency_penalty:
            payload["frequency_penalty"] = frequency_penalty
        if disable_thinking:
            # Every caller wants a short structured answer; reasoning models (Qwen/Ornith on vLLM)
            # otherwise spend max_tokens thinking and return empty content. Servers that do not
            # know the template flag ignore it.
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        if json_schema is not None:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "response", "strict": True, "schema": json_schema},
            }
        url = f"{self.base_url}/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=self.timeout, trust_env=False, headers=self._headers) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            # Older builds reject structured output; retry once as plain text.
            if json_schema is not None and exc.response is not None and exc.response.status_code == 400:
                return await self.chat(
                    messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    json_schema=None,
                    frequency_penalty=frequency_penalty,
                    disable_thinking=disable_thinking,
                )
            status = exc.response.status_code if exc.response is not None else "?"
            raise LMStudioError(f"LM Studio HTTP {status}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise LMStudioError(f"LM Studio request failed: {exc}") from exc
        try:
            return str(data["choices"][0]["message"]["content"] or "")
        except (KeyError, IndexError, TypeError) as exc:
            raise LMStudioError("LM Studio returned an unexpected payload") from exc

    async def health(self) -> bool:
        """Return True when the LM Studio model endpoint is reachable."""
        try:
            async with httpx.AsyncClient(timeout=min(5.0, self.timeout), trust_env=False, headers=self._headers) as client:
                resp = await client.get(f"{self.base_url}/models")
                resp.raise_for_status()
            return True
        except httpx.HTTPError:
            return False


def parse_json_response(content: str) -> dict[str, Any]:
    """Parse a JSON object out of a model response, tolerating code fences."""
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text[:4].lower() == "json":
            text = text[4:].strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    match = _JSON_OBJ_RE.search(text)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    raise LMStudioError("Could not parse JSON from LM Studio response")


def get_lm_studio_client() -> LMStudioClient:
    """Return an LM Studio client built from current settings."""
    return LMStudioClient()
