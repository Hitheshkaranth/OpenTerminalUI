from __future__ import annotations

from backend.core.provenance import make_provenance, provenance_from_snapshot


class TestMakeProvenance:
    def test_all_keys_present(self):
        p = make_provenance("yahoo", "delayed", as_of="2025-01-01T00:00:00+00:00", latency_ms=42.567, note="test")
        assert set(p.keys()) == {"source", "quality", "as_of", "latency_ms", "note"}
        assert p["source"] == "yahoo"
        assert p["quality"] == "delayed"
        assert p["as_of"] == "2025-01-01T00:00:00+00:00"
        assert p["latency_ms"] == 42.6
        assert p["note"] == "test"

    def test_latency_rounding(self):
        p = make_provenance("kite", "live", latency_ms=10.555)
        assert p["latency_ms"] == 10.6

    def test_none_latency(self):
        p = make_provenance("none", "unavailable", latency_ms=None)
        assert p["latency_ms"] is None

    def test_no_optional_args(self):
        p = make_provenance("fmp", "delayed")
        assert p["as_of"] is None
        assert p["latency_ms"] is None
        assert p["note"] is None


class TestProvenanceFromSnapshot:
    def test_empty_snap(self):
        p = provenance_from_snapshot({})
        assert p["source"] == "none"
        assert p["quality"] == "unavailable"
        assert p["note"] == "No provider returned data"
        assert p["as_of"] is None
        assert set(p.keys()) == {"source", "quality", "as_of", "latency_ms", "note"}

    def test_null_price_no_details(self):
        p = provenance_from_snapshot({"current_price": None})
        assert p["quality"] == "unavailable"
        assert p["source"] == "none"

    def test_yahoo_price_source(self):
        snap = {
            "current_price": 150.0,
            "details": {"price_source": "yahoo", "yahoo": True, "nse": False, "fmp": False, "finnhub": False, "kite": False},
        }
        p = provenance_from_snapshot(snap)
        assert p["source"] == "yahoo"
        assert p["quality"] == "delayed"
        assert p["note"] == "Yahoo Finance (delayed ~15m)"
        assert p["as_of"] is not None
        assert p["latency_ms"] is None

    def test_nse_price_source(self):
        snap = {
            "current_price": 2000.0,
            "details": {"price_source": "nse", "nse": True, "yahoo": False, "fmp": False, "finnhub": False, "kite": False},
        }
        p = provenance_from_snapshot(snap)
        assert p["source"] == "nse"
        assert p["quality"] == "live"
        assert p["as_of"] is not None

    def test_mock_source(self):
        snap = {
            "current_price": 100.0,
            "details": {"price_source": "mock", "mock": True, "yahoo": False, "nse": False, "fmp": False, "finnhub": False, "kite": False},
        }
        p = provenance_from_snapshot(snap)
        assert p["source"] == "mock"
        assert p["quality"] == "synthetic"
        assert p["note"] == "Synthetic fallback data — configure a provider"
        assert p["as_of"] is not None

    def test_from_cache(self):
        snap = {
            "current_price": 500.0,
            "details": {"price_source": "yahoo", "yahoo": True, "nse": False, "fmp": False, "finnhub": False, "kite": False},
        }
        p = provenance_from_snapshot(snap, from_cache=True)
        assert p["quality"] == "cached"
        assert p["as_of"] is None

    def test_from_cache_adapter_without_kite_not_labelled_kite(self):
        snap = {
            "current_price": 500.0,
            "details": {"price_source": "adapter", "yahoo": True, "nse": False, "fmp": False, "finnhub": False, "kite": False},
        }
        cached = provenance_from_snapshot(snap, from_cache=True)
        live = provenance_from_snapshot(snap)
        assert cached["source"] == live["source"] == "yahoo"
        assert cached["quality"] == "cached"

    def test_all_keys_present(self):
        snap = {
            "current_price": 100.0,
            "details": {"price_source": "fmp", "fmp": True, "yahoo": False, "nse": False, "finnhub": False, "kite": False},
        }
        p = provenance_from_snapshot(snap, latency_ms=12.345)
        assert set(p.keys()) == {"source", "quality", "as_of", "latency_ms", "note"}
        assert p["source"] == "fmp"
        assert p["quality"] == "delayed"
        assert p["latency_ms"] == 12.3

    def test_adapter_without_kite_flag(self):
        snap = {
            "current_price": 50.0,
            "details": {"price_source": "adapter", "kite": False, "nse": True, "yahoo": False, "fmp": False, "finnhub": False},
        }
        p = provenance_from_snapshot(snap)
        assert p["source"] == "nse"
        assert p["quality"] == "live"

    def test_kite_as_source(self):
        snap = {
            "current_price": 50.0,
            "details": {"price_source": "adapter", "kite": True, "nse": False, "yahoo": False, "fmp": False, "finnhub": False},
        }
        p = provenance_from_snapshot(snap)
        assert p["source"] == "kite"
        assert p["quality"] == "live"

def test_get_stock_attaches_provenance_to_response(monkeypatch):
    """Regression: the route computed provenance but never passed it to StockSnapshot."""
    import asyncio
    from types import SimpleNamespace

    from backend.api.routes import stocks as stocks_mod

    async def fake_classify(t):
        return SimpleNamespace(exchange="NSE", country_code="IN", flag_emoji="", currency="INR",
                               has_futures=False, has_options=False)

    async def fake_yf(t):
        return f"{t}.NS"

    async def fake_snapshot(t):
        return {"current_price": 10.0, "details": {"yahoo": True, "price_source": "yahoo"}}

    class Reg:
        async def invoke(self, *a, **k):
            raise RuntimeError("All adapters failed")

        def get_chain(self, ex):
            return []

        def health_snapshot(self):
            return {}

    monkeypatch.setattr(stocks_mod.market_classifier, "classify", fake_classify)
    monkeypatch.setattr(stocks_mod.market_classifier, "yfinance_symbol", fake_yf)
    monkeypatch.setattr(stocks_mod, "fetch_stock_snapshot_coalesced", fake_snapshot)
    monkeypatch.setattr(stocks_mod, "get_adapter_registry", lambda: Reg())

    snap = asyncio.run(stocks_mod.get_stock("RELIANCE"))
    # registry.invoke raised -> `q` must be safely None (was UnboundLocalError)
    assert snap.provenance is not None
    assert snap.provenance["source"] == "yahoo"
    assert snap.provenance["quality"] == "delayed"
    assert set(snap.provenance) == {"source", "quality", "as_of", "latency_ms", "note"}


def test_source_never_leaks_unavailable_literal():
    from backend.core.provenance import provenance_from_snapshot

    out = provenance_from_snapshot({"current_price": 1.0, "details": {"price_source": "unavailable"}})
    assert out["source"] == "none"
    assert out["quality"] == "unavailable"
