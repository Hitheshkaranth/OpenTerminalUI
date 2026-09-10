from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path


logger = logging.getLogger(__name__)

# Well-known API key environment variable names to warn about in .env files.
_API_KEY_VARS = frozenset(
    {
        "FMP_API_KEY",
        "FRED_API_KEY",
        "FINNHUB_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "OPENROUTER_API_KEY",
        "JWT_SECRET_KEY",
        "CACHE_SIGNING_KEY",
        "OPENTERMINALUI_FMP_API_KEY",
        "OPENTERMINALUI_OPENAI_API_KEY",
        "OPENTERMINALUI_OPENROUTER_API_KEY",
    }
)


def _workspace_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _candidate_env_files() -> tuple[Path, ...]:
    root = _workspace_root()
    return (
        root / ".env",
        root / "backend" / ".env",
    )


def _parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None
    key, _, value = stripped.partition("=")
    key = key.strip()
    value = value.strip().strip("'").strip('"')
    if not key:
        return None
    return key, value


@lru_cache(maxsize=1)
def load_local_env() -> None:
    for env_file in _candidate_env_files():
        if not env_file.exists():
            continue
        for line in env_file.read_text(encoding="utf-8").splitlines():
            parsed = _parse_env_line(line)
            if parsed is None:
                continue
            key, value = parsed
            os.environ.setdefault(key, value)

    # SECURITY: Warn if API keys are detected in the local .env file.
    # The .env file itself should be in .gitignore and never committed.
    _warned: set[str] = set()
    for env_var in _API_KEY_VARS:
        if env_var not in _warned and os.environ.get(env_var):
            # Check if the value looks like it might be a placeholder or default
            raw_val = os.environ.get(env_var, "")
            if raw_val in {"", "your-api-key-here", "CHANGE_ME", "TODO", "placeholder", "test-key"}:
                logger.warning(
                    "⚠  %s is set to an obvious placeholder value in .env. "
                    "Replace it with a real API key before use.",
                    env_var,
                )
            _warned.add(env_var)
