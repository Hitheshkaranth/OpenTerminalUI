from __future__ import annotations

from pathlib import Path

from backend.config.settings import get_settings


def test_default_sqlite_url_uses_workspace_local_data_dir(monkeypatch) -> None:
    monkeypatch.delenv("OPENTERMINALUI_SQLITE_URL", raising=False)
    monkeypatch.delenv("OPENSCREENS_SQLITE_URL", raising=False)
    monkeypatch.delenv("TRADE_SCREENS_SQLITE_URL", raising=False)
    get_settings.cache_clear()

    try:
        settings = get_settings()
        expected_path = (Path(__file__).resolve().parents[2] / "data" / "openterminalui.db").resolve()
        assert settings.sqlite_url == f"sqlite:///{expected_path.as_posix()}"
        assert expected_path.parent.exists()
    finally:
        get_settings.cache_clear()
