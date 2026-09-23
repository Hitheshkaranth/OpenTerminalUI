import pytest

import backend.agent.tools.derivatives_tools as dt


def _chain(strikes=None, market="NSE", **overrides):
    base = {
        "symbol": "NIFTY",
        "market": market,
        "spot_price": 100.0,
        "timestamp": "2026-01-01T00:00:00+00:00",
        "expiry_date": "2026-01-29",
        "available_expiries": ["2026-01-29"],
        "atm_strike": 100.0,
        "atm_iv": 15.0,
        "iv_rank": 40.0,
        "iv_percentile": 55.0,
        "totals": {"ce_oi_total": 100, "pe_oi_total": 90, "ce_volume_total": 10, "pe_volume_total": 8, "pcr_oi": 0.9, "pcr_volume": 0.8},
        "strikes": strikes if strikes is not None else [
            {
                "strike_price": 100.0,
                "ce": {"oi": 500, "oi_change": 20, "volume": 100, "iv": 14.5, "ltp": 5.2, "bid": 5.1, "ask": 5.3,
                       "price_change": 0.2, "greeks": {"delta": 0.52, "gamma": 0.01, "theta": -0.3, "vega": 0.12, "rho": 0.05}},
                "pe": {"oi": 400, "oi_change": -10, "volume": 80, "iv": 14.0, "ltp": 4.8, "bid": 4.7, "ask": 4.9,
                       "price_change": -0.1, "greeks": {"delta": -0.48, "gamma": 0.01, "theta": -0.25, "vega": 0.11, "rho": -0.04}},
            },
        ],
    }
    base.update(overrides)
    return base


class FakeOptionChainFetcher:
    def __init__(self, chain):
        self._chain = chain

    async def get_option_chain(self, symbol, expiry=None, strike_range=20):
        return self._chain


@pytest.mark.asyncio
async def test_get_option_chain_happy_path(monkeypatch):
    chain = _chain()
    monkeypatch.setattr(
        "backend.fno.services.option_chain_fetcher.get_option_chain_fetcher",
        lambda: FakeOptionChainFetcher(chain),
    )
    out = await dt.get_option_chain({"symbol": "nifty"})
    assert out["ok"] is True
    assert out["provenance"]["quality"] == "live"
    assert out["data"]["symbol"] == "NIFTY"
    row = out["data"]["strikes"][0]
    assert row["strike_price"] == 100.0
    # compact: only the documented leg fields, greeks/bid/ask dropped
    assert set(row["ce"]) == {"oi", "oi_change", "volume", "iv", "ltp"}


@pytest.mark.asyncio
async def test_get_option_chain_upstream_failure_returns_err(monkeypatch):
    class BrokenFetcher:
        async def get_option_chain(self, *a, **k):
            raise RuntimeError("NSE rejected the request")

    monkeypatch.setattr(
        "backend.fno.services.option_chain_fetcher.get_option_chain_fetcher",
        lambda: BrokenFetcher(),
    )
    out = await dt.get_option_chain({"symbol": "NIFTY"})
    assert out["ok"] is False
    assert "error" in out


@pytest.mark.asyncio
async def test_get_option_chain_no_strikes_is_err_not_raise(monkeypatch):
    monkeypatch.setattr(
        "backend.fno.services.option_chain_fetcher.get_option_chain_fetcher",
        lambda: FakeOptionChainFetcher(_chain(strikes=[])),
    )
    out = await dt.get_option_chain({"symbol": "NIFTY"})
    assert out["ok"] is False
    assert out["error"]["code"] == "no_data"


@pytest.mark.asyncio
async def test_analyze_option_greeks_picks_closest_strike(monkeypatch):
    strikes = [
        {"strike_price": 95.0, "ce": {"greeks": {"delta": 0.7}, "iv": 15.0, "ltp": 8.0}, "pe": {"greeks": {"delta": -0.3}, "iv": 14.0, "ltp": 1.5}},
        {"strike_price": 105.0, "ce": {"greeks": {"delta": 0.3}, "iv": 13.0, "ltp": 2.0}, "pe": {"greeks": {"delta": -0.7}, "iv": 16.0, "ltp": 7.5}},
    ]
    chain = _chain(strikes=strikes, atm_strike=105.0)
    monkeypatch.setattr(
        "backend.fno.services.option_chain_fetcher.get_option_chain_fetcher",
        lambda: FakeOptionChainFetcher(chain),
    )
    out = await dt.analyze_option_greeks({"symbol": "NIFTY", "strike": 106})
    assert out["ok"] is True
    assert out["data"]["strike"] == 105.0
    assert "delta" in out["data"]["call"]["read"]


@pytest.mark.asyncio
async def test_analyze_option_greeks_upstream_failure_returns_err(monkeypatch):
    class BrokenFetcher:
        async def get_option_chain(self, *a, **k):
            raise RuntimeError("boom")

    monkeypatch.setattr(
        "backend.fno.services.option_chain_fetcher.get_option_chain_fetcher",
        lambda: BrokenFetcher(),
    )
    out = await dt.analyze_option_greeks({"symbol": "NIFTY"})
    assert out["ok"] is False


class FakeFlowService:
    def __init__(self, unusual=None, summary=None):
        self._unusual = unusual or []
        self._summary = summary or {"total_premium": 0, "bullish_pct": 0, "bearish_pct": 0, "top_symbols": [], "premium_by_hour": [], "flow_count": 0}

    async def detect_unusual_activity(self, symbol=None, min_premium=0):
        return self._unusual

    async def get_flow_summary(self, period="1d"):
        return self._summary


class FakeOIAnalyzer:
    def analyze_oi_buildup(self, chain):
        return {"strikes": [{"strike_price": 100.0, "ce_pattern": "long_buildup", "pe_pattern": "short_covering",
                              "ce_oi_change": 20, "pe_oi_change": -10}]}

    def find_max_pain(self, chain):
        return 100.0

    def find_support_resistance(self, chain):
        return {"support": [95.0], "resistance": [105.0]}

    def get_pcr(self, chain):
        return {"pcr_oi": 0.9, "pcr_volume": 0.8, "pcr_oi_change": 0.1, "signal": "Neutral"}


@pytest.mark.asyncio
async def test_get_fno_flow_with_symbol(monkeypatch):
    chain = _chain()
    unusual = [{"timestamp": "t", "symbol": "NIFTY", "strike": 100.0, "option_type": "CE", "sentiment": "bullish",
                "volume": 500, "volume_ratio": 3.0, "oi_change": 20, "premium_value": 1000.0, "heat_score": 80.0}]
    monkeypatch.setattr(
        "backend.fno.services.option_chain_fetcher.get_option_chain_fetcher",
        lambda: FakeOptionChainFetcher(chain),
    )
    monkeypatch.setattr("backend.fno.services.oi_analyzer.get_oi_analyzer", lambda: FakeOIAnalyzer())
    monkeypatch.setattr("backend.fno.services.flow_service.get_options_flow_service", lambda: FakeFlowService(unusual=unusual))

    out = await dt.get_fno_flow({"symbol": "nifty"})
    assert out["ok"] is True
    assert out["data"]["pcr"]["signal"] == "Neutral"
    assert out["data"]["oi_buildup"][0]["ce_pattern"] == "long_buildup"
    assert len(out["data"]["unusual_activity"]) == 1


@pytest.mark.asyncio
async def test_get_fno_flow_without_symbol_uses_summary(monkeypatch):
    summary = {"total_premium": 500.0, "bullish_pct": 60.0, "bearish_pct": 40.0, "top_symbols": [], "premium_by_hour": [], "flow_count": 2}
    monkeypatch.setattr("backend.fno.services.flow_service.get_options_flow_service", lambda: FakeFlowService(summary=summary))
    out = await dt.get_fno_flow({})
    assert out["ok"] is True
    assert out["data"]["total_premium"] == 500.0


@pytest.mark.asyncio
async def test_get_fno_flow_upstream_failure_returns_err(monkeypatch):
    class BrokenFetcher:
        async def get_option_chain(self, *a, **k):
            raise RuntimeError("boom")

    monkeypatch.setattr(
        "backend.fno.services.option_chain_fetcher.get_option_chain_fetcher",
        lambda: BrokenFetcher(),
    )
    out = await dt.get_fno_flow({"symbol": "NIFTY"})
    assert out["ok"] is False


@pytest.mark.asyncio
async def test_get_futures_curve_happy_path(monkeypatch):
    async def fake_get_futures_chain(underlying):
        return {
            "underlying": underlying,
            "contracts": [
                {"expiry_date": "2026-01-29", "tradingsymbol": "NIFTY26JAN", "ltp": 102.0, "oi": 1000, "volume": 500},
                {"expiry_date": "2026-02-26", "tradingsymbol": "NIFTY26FEB", "ltp": 104.0, "oi": 800, "volume": 300},
            ],
        }

    class FakeFetcher:
        async def fetch_stock_snapshot(self, sym):
            return {"last_price": 100.0}

    async def fake_get_unified_fetcher():
        return FakeFetcher()

    monkeypatch.setattr("backend.fno.routes.futures.get_futures_chain", fake_get_futures_chain)
    monkeypatch.setattr("backend.api.deps.get_unified_fetcher", fake_get_unified_fetcher)

    out = await dt.get_futures_curve({"symbol": "NIFTY"})
    assert out["ok"] is True
    assert out["data"]["curve_shape"] == "contango"
    assert out["data"]["contracts"][0]["basis"] == 2.0


@pytest.mark.asyncio
async def test_get_futures_curve_no_contracts_is_err(monkeypatch):
    async def fake_get_futures_chain(underlying):
        return {"underlying": underlying, "contracts": []}

    monkeypatch.setattr("backend.fno.routes.futures.get_futures_chain", fake_get_futures_chain)
    out = await dt.get_futures_curve({"symbol": "NIFTY"})
    assert out["ok"] is False
    assert out["error"]["code"] == "no_data"


@pytest.mark.asyncio
async def test_get_futures_curve_upstream_failure_returns_err(monkeypatch):
    async def failing(underlying):
        raise RuntimeError("db down")

    monkeypatch.setattr("backend.fno.routes.futures.get_futures_chain", failing)
    out = await dt.get_futures_curve({"symbol": "NIFTY"})
    assert out["ok"] is False


@pytest.mark.asyncio
async def test_get_market_depth_is_always_synthetic(monkeypatch):
    out = await dt.get_market_depth({"symbol": "AAPL"})
    assert out["ok"] is True
    assert out["provenance"]["quality"] == "synthetic"
    assert "bids" in out["data"] and "asks" in out["data"]
    assert len(out["data"]["bids"]) <= 10


@pytest.mark.asyncio
async def test_get_market_depth_bad_symbol_returns_err():
    out = await dt.get_market_depth({"symbol": ""})
    assert out["ok"] is False


def test_all_tool_schemas_are_valid_object_schemas():
    specs = dt.derivatives_tool_specs()
    names = {s.name for s in specs}
    assert names == {"get_option_chain", "analyze_option_greeks", "get_fno_flow", "get_futures_curve", "get_market_depth"}
    for spec in specs:
        assert spec.parameters["type"] == "object"
        assert isinstance(spec.parameters["properties"], dict)
        assert spec.read_only is True
        assert spec.write_class == "none"
        assert spec.description
