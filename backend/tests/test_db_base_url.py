from __future__ import annotations

import os
from pathlib import Path

from backend.db.base import get_database_url
from backend.config.settings import get_settings


def test_get_database_url_syncs_with_settings(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("OPENTERMINALUI_SQLITE_URL", "sqlite:///C:/test/test.db")
    get_settings.cache_clear()

    url = get_database_url()
    assert url == "sqlite+aiosqlite:///C:/test/test.db"


def test_get_database_url_respects_database_url_env(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@host/db")
    get_settings.cache_clear()

    url = get_database_url()
    assert url == "postgresql+asyncpg://user:pass@host/db"


def test_get_database_url_default_is_workspace_local(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("OPENTERMINALUI_SQLITE_URL", raising=False)
    monkeypatch.delenv("OPENSCREENS_SQLITE_URL", raising=False)
    monkeypatch.delenv("TRADE_SCREENS_SQLITE_URL", raising=False)
    get_settings.cache_clear()

    url = get_database_url()
    expected_path = (Path(__file__).resolve().parents[2] / "data" / "openterminalui.db").resolve()
    assert url == f"sqlite+aiosqlite:///{expected_path.as_posix()}"
