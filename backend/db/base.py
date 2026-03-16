from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


def _default_database_url() -> str:
    root = Path(__file__).resolve().parents[2]
    database_path = (root / "data" / "openterminal.db").resolve()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{database_path.as_posix()}"


def _ensure_sqlite_parent(url: str) -> None:
    if url in {"sqlite://", "sqlite+aiosqlite://", "sqlite:///:memory:", "sqlite+aiosqlite:///:memory:"}:
        return
    prefixes = ("sqlite+aiosqlite:///", "sqlite:///")
    for prefix in prefixes:
        if not url.startswith(prefix):
            continue
        raw_path = url.removeprefix(prefix)
        if not raw_path or raw_path == ":memory:":
            return
        Path(raw_path).resolve().parent.mkdir(parents=True, exist_ok=True)
        return


def get_database_url() -> str:
    raw = os.getenv("DATABASE_URL", _default_database_url())
    if raw.startswith("postgresql://"):
        return raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    _ensure_sqlite_parent(raw)
    return raw


def create_engine_async() -> AsyncEngine:
    return create_async_engine(get_database_url(), future=True, pool_pre_ping=True)
