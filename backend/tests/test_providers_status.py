from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

# Ensure repo root is on sys.path
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class _FakeProbe:
    """Async methods that return immediately."""
    async def get_quotes(self, *a, **k):
        return []
    async def get_market_status(self, *a, **k):
        return {}
    async def get_quote(self, *a, **k):
        return {}
    async def get_company_profile(self, *a, **k):
        return {}


class _FakeFetcher:
    yahoo = _FakeProbe()
    nse = _FakeProbe()
    fmp = _FakeProbe()
    finnhub = _FakeProbe()
    kite = _FakeProbe()


class TestProvidersStatusShape:
    """Test that the providers_status function returns the correct Contract-2 shape."""

    @pytest.fixture(autouse=True)
    def _patch(self, monkeypatch):
        async def _mock():
            return _FakeFetcher()
        monkeypatch.setattr("backend.api.routes.providers.get_unified_fetcher", _mock)
        monkeypatch.setenv("FMP_API_KEY", "")
        monkeypatch.setenv("FINNHUB_API_KEY", "")

    def test_all_provider_ids_present_in_order(self):
        from backend.api.routes.providers import providers_status

        import time
        start = time.monotonic()
        result = asyncio.run(providers_status())
        elapsed = time.monotonic() - start

        # Top-level keys
        assert "checked_at" in result
        assert "overall" in result
        assert "providers" in result

        # Ordering of ids
        ids = [p["id"] for p in result["providers"]]
        expected_ids = ["kite", "alpaca", "fmp", "finnhub", "fred", "yahoo", "nse", "openrouter", "lmstudio"]
        assert ids == expected_ids

        # Each provider has all Contract-2 keys
        required_keys = {"id", "name", "markets", "configured", "status", "last_success_at", "last_error", "unlocks", "env_keys"}
        for p in result["providers"]:
            assert required_keys.issubset(set(p.keys())), f"Missing keys on {p['id']}: {required_keys - set(p.keys())}"

        # yahoo and nse are always configured (no env_keys)
        yahoo = next(p for p in result["providers"] if p["id"] == "yahoo")
        nse = next(p for p in result["providers"] if p["id"] == "nse")
        assert yahoo["configured"] is True
        assert nse["configured"] is True
        assert yahoo["env_keys"] == []
        assert nse["env_keys"] == []

        # Hanging probe timeout: < 3s
        assert elapsed < 3.0


class TestProvidersStatusConfiguredFlags:
    @pytest.fixture(autouse=True)
    def _patch(self, monkeypatch):
        async def _mock():
            return _FakeFetcher()
        monkeypatch.setattr("backend.api.routes.providers.get_unified_fetcher", _mock)
        monkeypatch.setenv("KITE_API_KEY", "k1")
        monkeypatch.setenv("KITE_API_SECRET", "s1")
        monkeypatch.setenv("KITE_ACCESS_TOKEN", "t1")
        monkeypatch.setenv("ALPACA_API_KEY", "a1")
        monkeypatch.setenv("ALPACA_SECRET_KEY", "b1")
        monkeypatch.setenv("FMP_API_KEY", "f1")
        monkeypatch.setenv("FINNHUB_API_KEY", "fn1")
        monkeypatch.setenv("FRED_API_KEY", "r1")
        monkeypatch.setenv("OPENROUTER_API_KEY", "o1")
        monkeypatch.setenv("LM_STUDIO_BASE_URL", "http://localhost:1234/v1")

    def test_all_configured_when_keys_set(self):
        from backend.api.routes.providers import providers_status

        result = asyncio.run(providers_status())
        for p in result["providers"]:
            assert p["configured"] is True

    def test_unconfigured_when_keys_missing(self, monkeypatch):
        from backend.api.routes.providers import providers_status

        # Unset all keys
        for key in ["KITE_API_KEY", "KITE_API_SECRET", "KITE_ACCESS_TOKEN",
                     "ALPACA_API_KEY", "ALPACA_SECRET_KEY",
                     "FMP_API_KEY", "FINNHUB_API_KEY",
                     "FRED_API_KEY", "OPENROUTER_API_KEY", "LM_STUDIO_BASE_URL"]:
            monkeypatch.delenv(key, raising=False)

        result = asyncio.run(providers_status())
        kite = next(p for p in result["providers"] if p["id"] == "kite")
        assert kite["configured"] is False


class TestProvidersStatusProbeTimeout:
    """A hanging probe should still return in < 3s due to asyncio.wait_for timeout."""

    @pytest.fixture(autouse=True)
    def _patch(self, monkeypatch):
        class _HangYahoo:
            async def get_quotes(self, *a, **k):
                await asyncio.sleep(10)
                return {}

        class _HangNSE:
            async def get_market_status(self, *a, **k):
                await asyncio.sleep(10)
                return {}

        class _HangFetcher:
            yahoo = _HangYahoo()
            nse = _HangNSE()
            fmp = _FakeProbe()
            finnhub = _FakeProbe()
            kite = _FakeProbe()

        async def _mock():
            return _HangFetcher()

        monkeypatch.setattr("backend.api.routes.providers.get_unified_fetcher", _mock)

    def test_hanging_probe_returns_fast(self, monkeypatch):
        monkeypatch.setenv("FMP_API_KEY", "")
        monkeypatch.setenv("FINNHUB_API_KEY", "")

        from backend.api.routes.providers import providers_status

        import time
        start = time.monotonic()
        result = asyncio.run(providers_status())
        elapsed = time.monotonic() - start

        assert elapsed < 3.0, f"providers_status took {elapsed:.2f}s, expected < 3s"
        assert "providers" in result
        assert "overall" in result
        assert "checked_at" in result


class TestProvidersStatusWithError:
    """Internal errors should be caught and return degraded."""

    @pytest.fixture(autouse=True)
    def _patch(self, monkeypatch):
        from backend.adapters import registry as reg_mod

        def _raise():
            raise RuntimeError("boom")

        monkeypatch.setattr(reg_mod, "get_adapter_registry", _raise)
        monkeypatch.setenv("FMP_API_KEY", "")
        monkeypatch.setenv("FINNHUB_API_KEY", "")

        async def _mock():
            return _FakeFetcher()

        monkeypatch.setattr("backend.api.routes.providers.get_unified_fetcher", _mock)

    def test_error_returns_degraded(self, monkeypatch):
        from backend.api.routes.providers import providers_status

        result = asyncio.run(providers_status())
        assert "providers" in result
        assert "overall" in result

def test_kite_reports_down_when_token_rejected(monkeypatch):
    """An expired KITE_ACCESS_TOKEN must surface as down with an actionable error,
    not as OK inferred from the adapter slot's fallback success."""
    import asyncio

    from backend.api.routes import providers as mod
    from backend.core import kite_client as kc

    monkeypatch.setenv("KITE_API_KEY", "k")
    monkeypatch.setenv("KITE_API_SECRET", "s")
    monkeypatch.setenv("KITE_ACCESS_TOKEN", "expired")

    async def rejected(self, token):
        return {}

    async def noop_close(self):
        return None

    monkeypatch.setattr(kc.KiteClient, "get_profile", rejected)
    monkeypatch.setattr(kc.KiteClient, "close", noop_close)

    class FakeYahoo:
        async def get_quotes(self, syms):
            return []

    class FakeNse:
        async def get_market_status(self):
            return {}

    class FakeKeyed:
        async def get_quote(self, sym):
            return {}

        async def get_company_profile(self, sym):
            return {}

    class FakeFetcher:
        yahoo = FakeYahoo()
        nse = FakeNse()
        fmp = FakeKeyed()
        finnhub = FakeKeyed()

    async def fake_fetcher():
        return FakeFetcher()

    monkeypatch.setattr(mod, "get_unified_fetcher", fake_fetcher)

    class Reg:
        def health_snapshot(self):
            return {"kite": {"available": True, "last_success_at": "2026-01-01T00:00:00+00:00", "last_error": None}}

    monkeypatch.setattr(mod, "get_adapter_registry", lambda: Reg())
    out = asyncio.run(mod.providers_status())
    assert "error" not in out, out.get("error")
    kite = next(p for p in out["providers"] if p["id"] == "kite")
    assert kite["status"] == "down"
    assert "access token" in (kite["last_error"] or "")
