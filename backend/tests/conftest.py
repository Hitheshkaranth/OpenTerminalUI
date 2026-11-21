from __future__ import annotations

import os

# Unset OPENTERMINALUI_ENV now means production (fail closed). The suite runs as a
# development-class "test" env so ephemeral secrets and dev-only toggles behave as
# before. Must happen before any `backend` import.
os.environ.setdefault("OPENTERMINALUI_ENV", "test")
os.environ.setdefault("RUN_BACKGROUND_SERVICES", "0")

import sys
from pathlib import Path

import pytest


# Auth rate limits (5 logins/minute) would otherwise 429 the suite, which logs in
# once per test. Must be set before any module that builds the limiter is imported.
os.environ.setdefault("RATE_LIMIT_ENABLED", "0")

# Never let the suite touch the developer's real database. `.env` is loaded with
# setdefault, so forcing these before any `backend` import wins over it. Tests that
# drop tables or delete users would otherwise wipe data/openterminalui.db.
# Set OT_TEST_DATABASE_URL to run against a specific (e.g. Postgres) test DB instead.
import tempfile as _tempfile

_test_db_url = os.environ.get("OT_TEST_DATABASE_URL") or (
    f"sqlite:///{Path(_tempfile.mkdtemp(prefix='ot-pytest-')).as_posix()}/test.db"
)
os.environ["DATABASE_URL"] = _test_db_url
os.environ["OPENTERMINALUI_SQLITE_URL"] = _test_db_url
# Same for the persistent cache (and never a shared Redis): fake test data must not reach the app.
os.environ["OPENTERMINALUI_CACHE_DB"] = str(Path(_tempfile.mkdtemp(prefix="ot-pytest-cache-")) / "cache.db")
os.environ.pop("REDIS_URL", None)


# Ensure `import backend...` works even when pytest is launched from `backend/`.
REPO_ROOT = Path(__file__).resolve().parents[2]
repo_root_str = str(REPO_ROOT)
if repo_root_str not in sys.path:
    sys.path.insert(0, repo_root_str)


@pytest.fixture(scope="session", autouse=True)
def _test_db_schema():
    """Create the schema on the throwaway test DB, as app startup does.

    Without this, tests that hit real routes (e.g. login → users table) only passed when an
    earlier test happened to create the tables, so they failed when run on their own.
    """
    from backend.shared.db import init_db

    init_db()
    yield


@pytest.fixture(autouse=True)
def _reset_auth_process_state():
    """Auth keeps small process-wide caches (user lookup TTL cache, login lockout).

    Clear them per test so one test's users/failures never leak into another.
    """
    yield
    from backend.auth.middleware import invalidate_user_cache
    from backend.equity.routes.auth import _reset_login_lockouts

    invalidate_user_cache()
    _reset_login_lockouts()


@pytest.fixture
def fixtures_dir() -> Path:
    return Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def mock_adapter():
    from backend.adapters.mock import MockDataAdapter

    return MockDataAdapter(seed=42)


@pytest.fixture
def mock_adapter_registry(monkeypatch, mock_adapter):
    from backend.adapters import registry as registry_module
    from backend.adapters.registry import AdapterRegistry

    class _MockOnlyRegistry(AdapterRegistry):
        def __init__(self) -> None:
            super().__init__()
            self._factory["mock"] = lambda: mock_adapter

    test_registry = _MockOnlyRegistry()
    monkeypatch.setattr(registry_module, "_registry", test_registry, raising=False)
    monkeypatch.setattr(registry_module, "get_adapter_registry", lambda: test_registry)
    return test_registry


@pytest.fixture(autouse=True)
def ensure_mock_adapter_registered():
    from backend.adapters.mock import MockDataAdapter
    from backend.adapters.registry import get_adapter_registry

    registry = get_adapter_registry()
    if "mock" not in registry._factory:  # noqa: SLF001
        registry._factory["mock"] = lambda: MockDataAdapter(seed=42)  # type: ignore[assignment] # noqa: SLF001
