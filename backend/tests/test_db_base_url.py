from __future__ import annotations

import os
from pathlib import Path

from backend.db.base import get_database_url, get_sync_database_url, sqlite_file_from_url
from backend.config.settings import get_settings


def test_get_database_url_syncs_with_settings(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)

    import sys
    import tempfile
    tmp = tempfile.gettempdir().replace("\\", "/")
    if sys.platform.startswith("win"):
        test_url = f"sqlite:///{tmp}/otui_test/test.db"
        expected_url = f"sqlite+aiosqlite:///{tmp}/otui_test/test.db"
    else:
        test_url = f"sqlite:///{tmp}/otui_test/test.db"
        expected_url = f"sqlite+aiosqlite:///{tmp}/otui_test/test.db"

    monkeypatch.setenv("OPENTERMINALUI_SQLITE_URL", test_url)
    get_settings.cache_clear()

    url = get_database_url()
    assert url == expected_url


def test_get_database_url_respects_database_url_env(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@host/db")
    get_settings.cache_clear()

    url = get_database_url()
    assert url == "postgresql+asyncpg://user:pass@host/db"


def test_get_sync_database_url_respects_database_url_env(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@host/db")
    get_settings.cache_clear()

    url = get_sync_database_url()
    assert url == "postgresql+psycopg://user:pass@host/db"


def test_get_sync_database_url_normalizes_aiosqlite(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:////tmp/openterminalui.db")
    get_settings.cache_clear()

    url = get_sync_database_url()
    assert url == "sqlite:////tmp/openterminalui.db"


def test_sqlite_file_from_url_supports_async_sqlite_urls() -> None:
    path = sqlite_file_from_url("sqlite+aiosqlite:////tmp/openterminalui.db")
    assert path == Path("/tmp/openterminalui.db").resolve()


def test_get_database_url_default_is_workspace_local(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("OPENTERMINALUI_SQLITE_URL", raising=False)
    monkeypatch.delenv("OPENSCREENS_SQLITE_URL", raising=False)
    monkeypatch.delenv("TRADE_SCREENS_SQLITE_URL", raising=False)
    get_settings.cache_clear()

    url = get_database_url()
    expected_path = (Path(__file__).resolve().parents[2] / "data" / "openterminalui.db").resolve()
    assert url == f"sqlite+aiosqlite:///{expected_path.as_posix()}"
