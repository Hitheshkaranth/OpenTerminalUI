import pytest
from backend.services.llm.factory import get_llm_provider, AGENT_PROVIDERS
from backend.services.llm.base import LLMError


def test_openrouter_provider_config(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-x")
    import backend.config.settings as s
    s.get_settings.cache_clear()
    try:
        p = get_llm_provider(provider="openrouter")
        assert p.base_url == "https://openrouter.ai/api/v1"
        assert p.api_key == "sk-or-x"
        assert "HTTP-Referer" in p.extra_headers
    finally:
        s.get_settings.cache_clear()


def test_lmstudio_provider_uses_lm_settings():
    p = get_llm_provider(provider="lmstudio")
    assert p.base_url.endswith("/v1")


def test_unknown_provider_raises():
    with pytest.raises(LLMError):
        get_llm_provider(provider="nope")


def test_known_providers_listed():
    assert set(AGENT_PROVIDERS) == {"openrouter", "openai", "lmstudio"}
