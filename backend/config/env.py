from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


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
