import backend.config.settings as settings_mod


def _fresh_settings():
    settings_mod.get_settings.cache_clear()
    try:
        return settings_mod.get_settings()
    finally:
        settings_mod.get_settings.cache_clear()


def test_agent_defaults(monkeypatch):
    for var in [
        "OPENTERMINALUI_OPENROUTER_API_KEY", "OPENROUTER_API_KEY",
        "OPENTERMINALUI_OPENROUTER_BASE_URL", "OPENROUTER_BASE_URL",
        "OPENTERMINALUI_AGENT_PROVIDER", "AGENT_PROVIDER",
        "OPENTERMINALUI_AGENT_MODEL", "AGENT_MODEL",
        "OPENTERMINALUI_AGENT_MAX_STEPS", "OPENTERMINALUI_AGENT_TIMEOUT_SECONDS",
    ]:
        monkeypatch.delenv(var, raising=False)
    s = _fresh_settings()
    assert s.agent_provider == "openrouter"
    assert s.agent_model == "anthropic/claude-opus-4-8"
    assert s.openrouter_base_url == "https://openrouter.ai/api/v1"
    assert s.openrouter_api_key is None
    assert s.agent_max_steps == 12
    assert s.agent_timeout_seconds == 120.0


def test_agent_env_override(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.setenv("OPENTERMINALUI_AGENT_MODEL", "openai/gpt-4o")
    s = _fresh_settings()
    assert s.openrouter_api_key == "sk-or-test"
    assert s.agent_model == "openai/gpt-4o"
