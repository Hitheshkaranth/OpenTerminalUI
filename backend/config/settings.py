from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from backend.config.env import load_local_env

load_local_env()


class AppSettings(BaseModel):
    app_name: str = "OpenTerminalUI API"
    app_version: str = "0.5.0"
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
        ]
    )
    sqlite_url: str = "sqlite:///data/openterminalui.db"
    redis_url: str = "redis://localhost:6379/0"
    redis_quote_channels_ttl: int = 300
    redis_max_connections: int = 50
    fred_api_key: str | None = None
    fmp_api_key: str | None = None
    finnhub_api_key: str | None = None
    ai_provider: str = "openai"  # openai or ollama
    openai_api_key: str | None = None
    ollama_base_url: str = "http://localhost:11434"
    lm_studio_base_url: str = "http://localhost:1234/v1"
    lm_studio_model: str = "google/gemma-4-26b-a4b"
    lm_studio_enabled: bool = True
    lm_studio_timeout_seconds: float = 240.0
    # Agent framework (multi-provider LLM)
    agent_provider: str = "openrouter"  # openrouter | openai | lmstudio
    # Default to a free OpenRouter model. Override via AGENT_MODEL / config.
    agent_model: str = "openai/gpt-oss-20b:free"
    # Free-only fallback chain tried in order when the primary model is
    # rate-limited (429) or unavailable (404). All entries must be ":free".
    agent_fallback_models: list[str] = Field(
        default_factory=lambda: [
            "openai/gpt-oss-20b:free",
            "qwen/qwen3-coder:free",
            "meta-llama/llama-3.3-70b-instruct:free",
        ]
    )
    agent_models_tool_use: list[str] = Field(
        default_factory=lambda: [
            "meta-llama/llama-3.3-70b-instruct:free",
            "qwen/qwen3-coder:free",
            "openai/gpt-oss-20b:free",
        ]
    )
    agent_models_reasoning: list[str] = Field(
        default_factory=lambda: [
            "deepseek/deepseek-r1:free",
            "qwen/qwq-32b:free",
            "openai/gpt-oss-120b:free",
            "openai/gpt-oss-20b:free",
        ]
    )
    agent_models_general: list[str] = Field(
        default_factory=lambda: [
            "openai/gpt-oss-20b:free",
            "google/gemini-2.0-flash-exp:free",
        ]
    )
    agent_max_steps: int = 12
    agent_deep_max_steps: int = 24
    agent_debate_enabled: bool = False
    agent_debate_analyst_max_steps: int = 4
    agent_strategy_loop_enabled: bool = False
    agent_strategy_loop_max_rounds: int = 3
    agent_timeout_seconds: float = 120.0
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_api_key: str | None = None
    price_cache_ttl_seconds: int = 60
    fundamentals_cache_ttl_seconds: int = 1800


def _workspace_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _default_sqlite_path(base: Path | None = None) -> Path:
    root = base or _workspace_root()
    return (root / "data" / "openterminalui.db").resolve()


def _default_sqlite_url(base: Path | None = None) -> str:
    return f"sqlite:///{_default_sqlite_path(base).as_posix()}"


def _default_cors_origins() -> list[str]:
    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ]


def _parse_cors_env(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    vals = [item.strip() for item in raw.split(",")]
    vals = [item for item in vals if item]
    return vals or None


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on", "y"}


def _env(name: str, legacy_name: str | None = None) -> str | None:
    val = os.getenv(name)
    if val is not None:
        return val
    if legacy_name:
        return os.getenv(legacy_name)
    return None


def _sqlite_path_from_url(sqlite_url: str) -> Path | None:
    if sqlite_url in {"sqlite://", "sqlite:///:memory:", "sqlite:///:memory"}:
        return None
    if sqlite_url.startswith("sqlite:////"):
        raw = f"/{sqlite_url.removeprefix('sqlite:////')}"
        return Path(raw).resolve()
    if sqlite_url.startswith("sqlite:///"):
        return Path(sqlite_url.removeprefix("sqlite:///")).resolve()
    if sqlite_url.startswith("sqlite://"):
        raw = sqlite_url.removeprefix("sqlite://")
        if not raw or raw == ":memory:":
            return None
        return Path(raw).resolve()
    return None


def _normalize_sqlite_url(sqlite_url: str, base: Path | None = None) -> str:
    root = base or _workspace_root()
    if sqlite_url in {"sqlite://", "sqlite:///:memory:", "sqlite:///:memory"}:
        return sqlite_url
    if sqlite_url.startswith("sqlite:////data/"):
        relative = sqlite_url.removeprefix("sqlite:////data/")
        return f"sqlite:///{(root / 'data' / relative).resolve().as_posix()}"
    if sqlite_url.startswith("sqlite:///"):
        raw = sqlite_url.removeprefix("sqlite:///")
        candidate = Path(raw)
        if not candidate.is_absolute():
            return f"sqlite:///{(root / candidate).resolve().as_posix()}"
    if sqlite_url.startswith("sqlite://") and not sqlite_url.startswith("sqlite:///"):
        raw = sqlite_url.removeprefix("sqlite://")
        if raw and raw != ":memory:":
            candidate = Path(raw)
            if not candidate.is_absolute():
                return f"sqlite:///{(root / candidate).resolve().as_posix()}"
    return sqlite_url


@lru_cache(maxsize=1)
def get_settings() -> AppSettings:
    base = _workspace_root()
    default_sqlite = _default_sqlite_url(base)
    settings_path = base / "backend" / "config" / "settings.yaml"
    payload: dict[str, Any] = {}
    if settings_path.exists():
        payload = yaml.safe_load(settings_path.read_text(encoding="utf-8")) or {}
    app_cfg = payload.get("app", {}) if isinstance(payload, dict) else {}
    cache_cfg = payload.get("cache", {}) if isinstance(payload, dict) else {}
    env_cors = _parse_cors_env(
        _env("OPENTERMINALUI_CORS_ORIGINS")
        or _env("OPENSCREENS_CORS_ORIGINS", "TRADE_SCREENS_CORS_ORIGINS")
    )
    settings = AppSettings(
        app_name=(
            _env("OPENTERMINALUI_APP_NAME")
            or _env("OPENSCREENS_APP_NAME", "TRADE_SCREENS_APP_NAME")
            or app_cfg.get("name", "OpenTerminalUI API")
        ),
        app_version=(
            _env("OPENTERMINALUI_APP_VERSION")
            or _env("OPENSCREENS_APP_VERSION", "TRADE_SCREENS_APP_VERSION")
            or app_cfg.get("version", "0.2.0")
        ),
        cors_origins=env_cors or app_cfg.get("cors_origins", _default_cors_origins()),
        sqlite_url=_normalize_sqlite_url(
            _env("OPENTERMINALUI_SQLITE_URL")
            or _env("OPENSCREENS_SQLITE_URL", "TRADE_SCREENS_SQLITE_URL")
            or payload.get("sqlite_url", default_sqlite),
            base,
        ),
        redis_url=(
            _env("OPENTERMINALUI_REDIS_URL")
            or _env("REDIS_URL")
            or app_cfg.get("redis_url", "redis://localhost:6379/0")
        ),
        redis_quote_channels_ttl=int(
            _env("OPENTERMINALUI_REDIS_QUOTE_CHANNELS_TTL")
            or app_cfg.get("redis_quote_channels_ttl", 300)
        ),
        redis_max_connections=int(
            _env("OPENTERMINALUI_REDIS_MAX_CONNECTIONS")
            or app_cfg.get("redis_max_connections", 50)
        ),
        fred_api_key=(
            _env("OPENTERMINALUI_FRED_API_KEY")
            or _env("FRED_API_KEY")
            or app_cfg.get("fred_api_key")
        ),
        fmp_api_key=(
            _env("OPENTERMINALUI_FMP_API_KEY")
            or _env("FMP_API_KEY")
            or app_cfg.get("fmp_api_key")
        ),
        finnhub_api_key=(
            _env("OPENTERMINALUI_FINNHUB_API_KEY")
            or _env("FINNHUB_API_KEY")
            or app_cfg.get("finnhub_api_key")
        ),
        ai_provider=(
            _env("OPENTERMINALUI_AI_PROVIDER")
            or _env("AI_PROVIDER")
            or app_cfg.get("ai_provider", "openai")
        ),
        openai_api_key=(
            _env("OPENTERMINALUI_OPENAI_API_KEY")
            or _env("OPENAI_API_KEY")
            or app_cfg.get("openai_api_key")
        ),
        ollama_base_url=(
            _env("OPENTERMINALUI_OLLAMA_BASE_URL")
            or _env("OLLAMA_BASE_URL")
            or app_cfg.get("ollama_base_url", "http://localhost:11434")
        ),
        lm_studio_base_url=(
            _env("OPENTERMINALUI_LM_STUDIO_BASE_URL")
            or _env("LM_STUDIO_BASE_URL")
            or app_cfg.get("lm_studio_base_url", "http://localhost:1234/v1")
        ),
        lm_studio_model=(
            _env("OPENTERMINALUI_LM_STUDIO_MODEL")
            or _env("LM_STUDIO_MODEL")
            or app_cfg.get("lm_studio_model", "google/gemma-4-26b-a4b")
        ),
        lm_studio_enabled=_as_bool(
            _env("OPENTERMINALUI_LM_STUDIO_ENABLED")
            or _env("LM_STUDIO_ENABLED")
            or app_cfg.get("lm_studio_enabled", True),
            default=True,
        ),
        lm_studio_timeout_seconds=float(
            _env("OPENTERMINALUI_LM_STUDIO_TIMEOUT_SECONDS")
            or app_cfg.get("lm_studio_timeout_seconds", 30.0)
        ),
        agent_provider=(
            _env("OPENTERMINALUI_AGENT_PROVIDER")
            or _env("AGENT_PROVIDER")
            or app_cfg.get("agent_provider", "openrouter")
        ),
        agent_model=(
            _env("OPENTERMINALUI_AGENT_MODEL")
            or _env("AGENT_MODEL")
            or app_cfg.get("agent_model", "openai/gpt-oss-20b:free")
        ),
        agent_fallback_models=(
            _parse_cors_env(_env("AGENT_FALLBACK_MODELS"))
            or app_cfg.get("agent_fallback_models")
            or [
                "openai/gpt-oss-20b:free",
                "qwen/qwen3-coder:free",
                "meta-llama/llama-3.3-70b-instruct:free",
            ]
        ),
        agent_models_tool_use=(
            _parse_cors_env(_env("OPENTERMINALUI_AGENT_MODELS_TOOL_USE") or _env("AGENT_MODELS_TOOL_USE"))
            or app_cfg.get("agent_models_tool_use")
            or ["meta-llama/llama-3.3-70b-instruct:free", "qwen/qwen3-coder:free", "openai/gpt-oss-20b:free"]
        ),
        agent_models_reasoning=(
            _parse_cors_env(_env("OPENTERMINALUI_AGENT_MODELS_REASONING") or _env("AGENT_MODELS_REASONING"))
            or app_cfg.get("agent_models_reasoning")
            or ["deepseek/deepseek-r1:free", "qwen/qwq-32b:free", "openai/gpt-oss-120b:free", "openai/gpt-oss-20b:free"]
        ),
        agent_models_general=(
            _parse_cors_env(_env("OPENTERMINALUI_AGENT_MODELS_GENERAL") or _env("AGENT_MODELS_GENERAL"))
            or app_cfg.get("agent_models_general")
            or ["openai/gpt-oss-20b:free", "google/gemini-2.0-flash-exp:free"]
        ),
        agent_max_steps=int(
            _env("OPENTERMINALUI_AGENT_MAX_STEPS")
            or str(app_cfg.get("agent_max_steps", 12))
        ),
        agent_deep_max_steps=int(
            _env("OPENTERMINALUI_AGENT_DEEP_MAX_STEPS")
            or str(app_cfg.get("agent_deep_max_steps", 24))
        ),
        agent_debate_enabled=_as_bool(
            _env("OPENTERMINALUI_AGENT_DEBATE_ENABLED", "AGENT_DEBATE_ENABLED")
            or app_cfg.get("agent_debate_enabled", False),
            default=False,
        ),
        agent_debate_analyst_max_steps=int(
            _env("OPENTERMINALUI_AGENT_DEBATE_ANALYST_MAX_STEPS", "AGENT_DEBATE_ANALYST_MAX_STEPS")
            or str(app_cfg.get("agent_debate_analyst_max_steps", 4))
        ),
        agent_strategy_loop_enabled=_as_bool(
            _env("OPENTERMINALUI_AGENT_STRATEGY_LOOP_ENABLED", "AGENT_STRATEGY_LOOP_ENABLED")
            or app_cfg.get("agent_strategy_loop_enabled", False),
            default=False,
        ),
        agent_strategy_loop_max_rounds=int(
            _env("OPENTERMINALUI_AGENT_STRATEGY_LOOP_MAX_ROUNDS", "AGENT_STRATEGY_LOOP_MAX_ROUNDS")
            or str(app_cfg.get("agent_strategy_loop_max_rounds", 3))
        ),
        agent_timeout_seconds=float(
            _env("OPENTERMINALUI_AGENT_TIMEOUT_SECONDS")
            or str(app_cfg.get("agent_timeout_seconds", 120.0))
        ),
        openrouter_base_url=(
            _env("OPENTERMINALUI_OPENROUTER_BASE_URL")
            or _env("OPENROUTER_BASE_URL")
            or app_cfg.get("openrouter_base_url", "https://openrouter.ai/api/v1")
        ),
        openrouter_api_key=(
            _env("OPENTERMINALUI_OPENROUTER_API_KEY")
            or _env("OPENROUTER_API_KEY")
            or app_cfg.get("openrouter_api_key")
        ),
        price_cache_ttl_seconds=int(
            _env("OPENTERMINALUI_PRICE_CACHE_TTL_SECONDS")
            or _env("OPENSCREENS_PRICE_CACHE_TTL_SECONDS", "TRADE_SCREENS_PRICE_CACHE_TTL_SECONDS")
            or str(cache_cfg.get("price_ttl_seconds", 60))
        ),
        fundamentals_cache_ttl_seconds=int(
            _env("OPENTERMINALUI_FUNDAMENTALS_CACHE_TTL_SECONDS")
            or _env("OPENSCREENS_FUNDAMENTALS_CACHE_TTL_SECONDS", "TRADE_SCREENS_FUNDAMENTALS_CACHE_TTL_SECONDS")
            or str(cache_cfg.get("fundamentals_ttl_seconds", 1800))
        ),
    )
    sqlite_path = _sqlite_path_from_url(settings.sqlite_url)
    if sqlite_path is not None:
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    return settings
