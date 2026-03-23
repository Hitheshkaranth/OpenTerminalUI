from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from backend.config.settings import get_settings


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
        # If it's a Windows path like C:/, resolve() handles it
        import pathlib
        pathlib.Path(raw_path).resolve().parent.mkdir(parents=True, exist_ok=True)
        return


def get_database_url() -> str:
    # Use DATABASE_URL if provided (e.g. for PostgreSQL in prod)
    # Otherwise use settings.sqlite_url (which already handles OPENTERMINALUI_SQLITE_URL)
    settings = get_settings()
    raw = os.getenv("DATABASE_URL")
    if not raw:
        raw = settings.sqlite_url

    if raw.startswith("postgresql://"):
        return raw.replace("postgresql://", "postgresql+asyncpg://", 1)

    # If it's a standard sqlite URL, convert to aiosqlite for async usage
    if raw.startswith("sqlite:///") and not raw.startswith("sqlite+aiosqlite:///"):
        raw = raw.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    elif raw.startswith("sqlite://") and not raw.startswith("sqlite+aiosqlite://") and not raw.startswith("sqlite:///"):
        raw = raw.replace("sqlite://", "sqlite+aiosqlite://", 1)

    _ensure_sqlite_parent(raw)
    return raw


def create_engine_async() -> AsyncEngine:
    return create_async_engine(get_database_url(), future=True, pool_pre_ping=True)
