from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class AppSettings(BaseModel):
    app_name: str = "OpenTerminalUI API"
    app_version: str = "0.1.0"
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
        ]
    )
    sqlite_url: str = "sqlite:///backend/openterminalui.db"
    redis_url: str = "redis://localhost:6379/0"
    redis_quote_channels_ttl: int = 300
    redis_max_connections: int = 50
    fred_api_key: str | None = None
    fmp_api_key: str | None = None
    finnhub_api_key: str | None = None
    ai_provider: str = "openai"  # openai or ollama
    openai_api_key: str | None = None
    ollama_base_url: str = "http://localhost:11434"
    price_cache_ttl_seconds: int = 60
    fundamentals_cache_ttl_seconds: int = 1800


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


def _env(name: str, legacy_name: str | None = None) -> str | None:
    val = os.getenv(name)
    if val is not None:
        return val
    if legacy_name:
        return os.getenv(legacy_name)
    return None


@lru_cache(maxsize=1)
def get_settings() -> AppSettings:
    base = Path(__file__).resolve().parents[2]
    default_sqlite = f"sqlite:///{(base / 'backend' / 'openterminalui.db').resolve().as_posix()}"
    settings_path = base / "config" / "settings.yaml"
    legacy_path = base.parent / "config" / "settings.yaml"
    payload: dict[str, Any] = {}
    source = settings_path if settings_path.exists() else legacy_path
    if source.exists():
        payload = yaml.safe_load(source.read_text(encoding="utf-8")) or {}
    app_cfg = payload.get("app", {}) if isinstance(payload, dict) else {}
    cache_cfg = payload.get("cache", {}) if isinstance(payload, dict) else {}
    env_cors = _parse_cors_env(
        _env("OPENTERMINALUI_CORS_ORIGINS")
        or _env("OPENSCREENS_CORS_ORIGINS", "TRADE_SCREENS_CORS_ORIGINS")
    )
    return AppSettings(
        app_name=(
            _env("OPENTERMINALUI_APP_NAME")
            or _env("OPENSCREENS_APP_NAME", "TRADE_SCREENS_APP_NAME")
            or app_cfg.get("name", "OpenTerminalUI API")
        ),
        app_version=(
            _env("OPENTERMINALUI_APP_VERSION")
            or _env("OPENSCREENS_APP_VERSION", "TRADE_SCREENS_APP_VERSION")
            or app_cfg.get("version", "0.1.0")
        ),
        cors_origins=env_cors or app_cfg.get("cors_origins", _default_cors_origins()),
        sqlite_url=(
            _env("OPENTERMINALUI_SQLITE_URL")
            or _env("OPENSCREENS_SQLITE_URL", "TRADE_SCREENS_SQLITE_URL")
            or payload.get("sqlite_url", default_sqlite)
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
