from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


def get_database_url() -> str:
    raw = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/openterminal.db")
    if raw.startswith("postgresql://"):
        return raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    return raw


def create_engine_async() -> AsyncEngine:
    return create_async_engine(get_database_url(), future=True, pool_pre_ping=True)
