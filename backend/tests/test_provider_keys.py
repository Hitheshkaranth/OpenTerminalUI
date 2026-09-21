from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from pydantic import BaseModel

# Ensure backend is importable
import sys
from pathlib import Path as _Path
_REPO_ROOT = _Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Import the module so we can monkeypatch _env_path
from backend.api.routes import provider_keys as _mod


@pytest.fixture(autouse=True)
def _setup_env_file(monkeypatch, tmp_path):
    """Point _env_path to tmp_path/.env and clear allowlisted env vars."""
    env_file = tmp_path / ".env"
    monkeypatch.setattr(_mod, "_env_path", lambda: env_file)

    # Clear all provider env keys from os.environ
    for name in _mod.PROVIDER_ENV_KEYS:
        monkeypatch.delenv(name, raising=False)

    # Also clear some known ones that settings might read
    for key in ["KITE_API_KEY", "KITE_API_SECRET", "KITE_ACCESS_TOKEN",
                 "ALPACA_API_KEY", "ALPACA_SECRET_KEY",
                 "FMP_API_KEY", "FINNHUB_API_KEY",
                 "FRED_API_KEY", "OPENROUTER_API_KEY", "LM_STUDIO_BASE_URL"]:
        monkeypatch.delenv(key, raising=False)

    # Remove file so tests start clean
    if env_file.exists():
        env_file.unlink()


def _make_admin_app() -> FastAPI:
    """Mini app with admin user override."""
    app = FastAPI()

    class _User:
        role = "admin"

    def _fake_admin():
        return _User()

    # Override get_current_user; require_role depends on it
    from backend.auth.deps import get_current_user
    app.dependency_overrides[get_current_user] = _fake_admin
    return app


def _make_viewer_app() -> FastAPI:
    """Mini app with viewer user override."""
    # Disable dev environment so get_current_user's dev-fallback doesn't
    # return an admin before the override can take effect.
    os.environ.setdefault("OPENTERMINALUI_ENV", "testing")
    app = FastAPI()

    class _User:
        role = "viewer"

    def _fake_viewer():
        return _User()

    from backend.auth.deps import get_current_user
    app.dependency_overrides[get_current_user] = _fake_viewer
    return app


# ─── GET ───────────────────────────────────────────────────────────────────

class TestGetProviderKeys:
    def test_get_returns_correct_shape(self, _setup_env_file):
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.get("/api/settings/provider-keys")
        assert resp.status_code == 200
        body = resp.json()
        assert "env_file" in body
        assert body["env_file"].endswith(".env")
        assert "keys" in body
        # Should contain all provider env keys
        names = {k["name"] for k in body["keys"]}
        expected = set(_mod.PROVIDER_ENV_KEYS.keys())
        assert names == expected

        # Every key entry has the right shape
        for k in body["keys"]:
            assert set(k.keys()) == {"name", "provider", "set", "masked", "source"}
            assert k["source"] in ("env_file", "process", "unset")

    def test_get_masking_long_value(self, _setup_env_file):
        env_file = _mod._env_path()
        env_file.write_text("KITE_API_KEY=abcdefgh\n", encoding="utf-8")
        os.environ["KITE_API_KEY"] = "abcdefgh"

        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.get("/api/settings/provider-keys")
        body = resp.json()
        kite_key = next(k for k in body["keys"] if k["name"] == "KITE_API_KEY")
        assert kite_key["masked"] == "ab\u2026gh"
        assert kite_key["set"] is True
        assert kite_key["source"] == "env_file"

    def test_get_masking_short_value(self, _setup_env_file):
        env_file = _mod._env_path()
        env_file.write_text("KITE_API_KEY=abc\n", encoding="utf-8")
        os.environ["KITE_API_KEY"] = "abc"

        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.get("/api/settings/provider-keys")
        body = resp.json()
        kite_key = next(k for k in body["keys"] if k["name"] == "KITE_API_KEY")
        assert kite_key["masked"] == "\u2022" * 4
        assert kite_key["set"] is True
        assert kite_key["source"] == "env_file"

    def test_get_unset_key(self, _setup_env_file):
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.get("/api/settings/provider-keys")
        body = resp.json()
        # Pick any key that has no env var set
        unset = [k for k in body["keys"] if not k["set"]]
        assert len(unset) > 0
        for k in unset:
            assert k["masked"] is None
            assert k["source"] == "unset"

    def test_get_process_source(self, _setup_env_file):
        # Set in os.environ only, not in file
        os.environ["KITE_API_KEY"] = "abcdef01"

        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.get("/api/settings/provider-keys")
        body = resp.json()
        kite_key = next(k for k in body["keys"] if k["name"] == "KITE_API_KEY")
        assert kite_key["source"] == "process"
        assert kite_key["set"] is True

    def test_get_all_providers_mapped(self, _setup_env_file):
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.get("/api/settings/provider-keys")
        body = resp.json()
        for k in body["keys"]:
            assert k["provider"] == _mod.PROVIDER_ENV_KEYS[k["name"]]


# ─── PUT ───────────────────────────────────────────────────────────────────

class TestPutProviderKeys:
    def test_put_writes_file_in_place(self, _setup_env_file):
        env_file = _mod._env_path()
        # Pre-existing content with comments and unrelated lines
        env_file.write_text(
            "# Some comment\n"
            "DATABASE_URL=sqlite:///data/test.db\n"
            "# managed by Settings \u2192 Data Providers\n"
            "KITE_API_KEY=old_key\n"
            "OTHER=value\n",
            encoding="utf-8",
        )
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.put("/api/settings/provider-keys", json={
            "values": {"KITE_API_KEY": "new_key"}
        })
        assert resp.status_code == 200
        content = env_file.read_text(encoding="utf-8")
        assert "DATABASE_URL=sqlite:///data/test.db" in content
        assert "KITE_API_KEY=new_key" in content
        assert "# Some comment" in content
        assert "# managed by Settings \u2192 Data Providers" in content
        assert "OTHER=value" in content

    def test_put_appends_new_key_under_marker(self, _setup_env_file):
        env_file = _mod._env_path()
        env_file.write_text(
            "# managed by Settings \u2192 Data Providers\n",
            encoding="utf-8",
        )
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.put("/api/settings/provider-keys", json={
            "values": {"ALPACA_API_KEY": "alpaca_key_123"}
        })
        assert resp.status_code == 200
        content = env_file.read_text(encoding="utf-8")
        assert "ALPACA_API_KEY=alpaca_key_123" in content
        assert "# managed by Settings \u2192 Data Providers" in content

    def test_put_appends_when_no_marker(self, _setup_env_file):
        env_file = _mod._env_path()
        env_file.write_text(
            "# Unrelated config\n"
            "SOME_VAR=foo\n",
            encoding="utf-8",
        )
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.put("/api/settings/provider-keys", json={
            "values": {"FMP_API_KEY": "fmp_key"}
        })
        assert resp.status_code == 200
        content = env_file.read_text(encoding="utf-8")
        assert "FMP_API_KEY=fmp_key" in content
        assert "# managed by Settings" in content

    def test_put_sets_os_environ(self, _setup_env_file):
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.put("/api/settings/provider-keys", json={
            "values": {"KITE_API_KEY": "env_var_test_value"}
        })
        assert resp.status_code == 200
        assert os.environ.get("KITE_API_KEY") == "env_var_test_value"

    def test_put_empty_string_clears(self, _setup_env_file):
        env_file = _mod._env_path()
        env_file.write_text("KITE_API_KEY=some_value\n", encoding="utf-8")
        os.environ["KITE_API_KEY"] = "some_value"

        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.put("/api/settings/provider-keys", json={
            "values": {"KITE_API_KEY": ""}
        })
        assert resp.status_code == 200
        assert "KITE_API_KEY=" in env_file.read_text(encoding="utf-8")
        assert os.environ.get("KITE_API_KEY") is None

    def test_put_unknown_name_422(self, _setup_env_file):
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.put("/api/settings/provider-keys", json={
            "values": {"NOT_A_REAL_KEY": "value"}
        })
        assert resp.status_code == 422
        assert "unknown key" in resp.json()["detail"]

    def test_put_newline_422(self, _setup_env_file):
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.put("/api/settings/provider-keys", json={
            "values": {"KITE_API_KEY": "bad\nvalue"}
        })
        assert resp.status_code == 422

    def test_put_applied_live_vs_restart_required(self, _setup_env_file):
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.put("/api/settings/provider-keys", json={
            "values": {
                "KITE_ACCESS_TOKEN": "live_token",  # applied_live
                "LM_STUDIO_BASE_URL": "http://localhost:1234",  # applied_live
                "OPENROUTER_API_KEY": "live_key",  # applied_live
                "FRED_API_KEY": "live_fred",  # applied_live
                "KITE_API_KEY": "restart_key",  # restart_required
                "ALPACA_API_KEY": "restart_key2",  # restart_required
            }
        })
        assert resp.status_code == 200
        body = resp.json()
        assert "applied_live" in body
        assert "restart_required" in body
        assert "KITE_ACCESS_TOKEN" in body["applied_live"]
        assert "LM_STUDIO_BASE_URL" in body["applied_live"]
        assert "OPENROUTER_API_KEY" in body["applied_live"]
        assert "FRED_API_KEY" in body["applied_live"]
        assert "KITE_API_KEY" in body["restart_required"]
        assert "ALPACA_API_KEY" in body["restart_required"]

    def test_put_trailing_newline(self, _setup_env_file):
        env_file = _mod._env_path()
        env_file.write_text("KITE_API_KEY=old\n", encoding="utf-8")
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        client.put("/api/settings/provider-keys", json={
            "values": {"KITE_API_KEY": "new"}
        })
        content = env_file.read_text(encoding="utf-8")
        assert content.endswith("\n")


# ─── Auth ──────────────────────────────────────────────────────────────────

class TestAuth:
    def test_non_admin_returns_403(self, _setup_env_file):
        app = _make_viewer_app()
        app.include_router(_mod.router, prefix="/api")
        client = TestClient(app)
        resp = client.get("/api/settings/provider-keys")
        assert resp.status_code == 403

    def test_admin_returns_200(self, _setup_env_file):
        app = _make_admin_app()
        app.include_router(_mod.router, prefix="/api")
        client = TestClient(app)
        resp = client.get("/api/settings/provider-keys")
        assert resp.status_code == 200

    def test_put_non_admin_returns_403(self, _setup_env_file):
        app = _make_viewer_app()
        app.include_router(_mod.router, prefix="/api")
        client = TestClient(app)
        resp = client.put("/api/settings/provider-keys", json={
            "values": {"KITE_API_KEY": "x"}
        })
        assert resp.status_code == 403


# ─── POST test/{id} ───────────────────────────────────────────────────────

class TestProbeProvider:
    def test_unknown_provider_404(self, _setup_env_file):
        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.post("/api/settings/provider-keys/test/nonexistent_provider_xyz")
        assert resp.status_code == 404

    def test_yahoo_returns_contract2_row(self, _setup_env_file, monkeypatch):
        monkeypatch.delenv("KITE_API_KEY", raising=False)

        class FakeYahoo:
            async def get_quotes(self, *a, **kw):
                return [{"symbol": "AAPL", "price": 150.0}]

        class FakeFetcher:
            yahoo = FakeYahoo()

        async def fake_fetcher():
            return FakeFetcher()

        # The test endpoint delegates to providers.probe_provider (single source of truth);
        # stub that rather than the network layer.
        async def fake_probe(provider_id):
            return {"provider": provider_id, "status": "ok", "last_error": None,
                    "checked_at": "2026-01-01T00:00:00+00:00", "env_keys": [], "configured": True}

        monkeypatch.setattr(_mod, "probe_provider", fake_probe)

        client = TestClient(_make_admin_app())
        client.app.include_router(_mod.router, prefix="/api")
        resp = client.post("/api/settings/provider-keys/test/yahoo")
        assert resp.status_code == 200
        body = resp.json()
        assert body["provider"] == "yahoo"
        assert "status" in body
        assert "checked_at" in body
        assert set(body.keys()) == {"provider", "status", "last_error", "checked_at"}