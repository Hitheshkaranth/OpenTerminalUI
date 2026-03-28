from __future__ import annotations

from pathlib import Path

from backend.config import env as env_module
from backend.config.settings import get_settings


def test_load_local_env_prefers_repo_root_env(monkeypatch, tmp_path: Path) -> None:
    root_env = tmp_path / ".env"
    backend_env = tmp_path / "backend.env"
    root_env.write_text("FMP_API_KEY=root-key\nJWT_SECRET_KEY=root-secret\n", encoding="utf-8")
    backend_env.write_text("FMP_API_KEY=backend-key\nJWT_SECRET_KEY=backend-secret\n", encoding="utf-8")

    monkeypatch.delenv("FMP_API_KEY", raising=False)
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    monkeypatch.setattr(env_module, "_candidate_env_files", lambda: (root_env, backend_env))
    env_module.load_local_env.cache_clear()
    get_settings.cache_clear()

    try:
        env_module.load_local_env()
        settings = get_settings()
        assert settings.fmp_api_key == "root-key"
    finally:
        env_module.load_local_env.cache_clear()
        get_settings.cache_clear()
