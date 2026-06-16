from __future__ import annotations

from backend.config.settings import get_settings
from backend.services.llm.base import LLMError
from backend.services.llm.openai_compatible import OpenAICompatibleProvider

AGENT_PROVIDERS = ("openrouter", "openai", "lmstudio")


def get_llm_provider(
    *, provider: str | None = None, model: str | None = None,
    api_key: str | None = None,
) -> OpenAICompatibleProvider:
    """Build an OpenAI-compatible provider for the agent from settings + overrides."""
    settings = get_settings()
    provider = (provider or settings.agent_provider or "openrouter").lower()
    timeout = settings.agent_timeout_seconds

    if provider == "openrouter":
        return OpenAICompatibleProvider(
            base_url=settings.openrouter_base_url,
            api_key=api_key or settings.openrouter_api_key,
            model=model or settings.agent_model,
            timeout=timeout,
            extra_headers={
                "HTTP-Referer": "https://openterminalui.local",
                "X-Title": "OpenTerminalUI Agent",
            },
        )
    if provider == "openai":
        return OpenAICompatibleProvider(
            base_url="https://api.openai.com/v1",
            api_key=api_key or settings.openai_api_key,
            model=model or settings.agent_model,
            timeout=timeout,
        )
    if provider == "lmstudio":
        return OpenAICompatibleProvider(
            base_url=settings.lm_studio_base_url,
            api_key=None,
            model=model or settings.lm_studio_model,
            timeout=timeout,
        )
    raise LLMError(f"Unknown agent provider: {provider}")
