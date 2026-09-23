"""Tests for the cross-sectional analytics tools (analytics_tools.py).

Follows test_agent_market_tools.py's pattern: monkeypatch the module's own data-loading
helpers (fetcher/chart-parsing/DB), then let the real statistical engines
(cointegration_analysis, FactorAttributionEngine, pandas .corr()) run on controlled
synthetic data so the assertions cover real math, not a mock's return value.
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

import backend.agent.tools.analytics_tools as at
from backend.agent.tools.registry import ToolRegistry


def _price_frame(n: int, seed: int) -> pd.DataFrame:
    idx = pd.date_range("2024-01-01", periods=n, freq="B")
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0.05, 1.0, n))
    return pd.DataFrame({
        "Open": close, "High": close + 1, "Low": close - 1, "Close": close,
        "Volume": [1_000_000] * n,
    }, index=idx)


class _FakeFetcher:
    def __init__(self, frames: dict[str, pd.DataFrame], snapshots: dict[str, dict] | None = None):
        self._frames = frames
        self._snapshots = snapshots or {}

    async def fetch_history(self, symbol, range_str="1y", interval="1d"):
        if symbol not in self._frames:
            raise ValueError(f"no data for {symbol}")
        return {"chart": {}, "_symbol": symbol}

    async def fetch_stock_snapshot(self, symbol):
        return self._snapshots.get(symbol, {})


# ---------------------------------------------------------------------------
# Registry / schema sanity
# ---------------------------------------------------------------------------

def test_analytics_tool_specs_schema_and_registration():
    specs = at.analytics_tool_specs()
    names = {s.name for s in specs}
    assert names == {
        "get_correlation_matrix", "analyze_pair_trade", "run_factor_analysis", "analyze_execution_quality",
    }
    reg = ToolRegistry()
    reg.register_many(specs)
    for spec in specs:
        assert spec.parameters["type"] == "object"
        assert spec.read_only is True
        assert spec.write_class == "none"
        assert spec.description


# ---------------------------------------------------------------------------
# get_correlation_matrix
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_correlation_matrix_happy_path(monkeypatch):
    idx = pd.date_range("2024-01-01", periods=80, freq="B")
    rng = np.random.default_rng(3)
    base = rng.normal(0, 0.01, 80)
    returns_df = pd.DataFrame({
        "AAPL": base + rng.normal(0, 0.001, 80),
        "MSFT": base + rng.normal(0, 0.001, 80),  # highly correlated with AAPL by construction
        "TSLA": rng.normal(0, 0.02, 80),
    }, index=idx)

    async def fake_loader(symbols, period, frequency):
        return returns_df[symbols]

    monkeypatch.setattr(at, "_corr_returns_frame", fake_loader)

    out = await at.get_correlation_matrix({"tickers": ["AAPL", "MSFT", "TSLA"], "period": "1Y"})
    assert out["ok"] is True
    data = out["data"]
    assert data["symbols"] == ["AAPL", "MSFT", "TSLA"]
    assert len(data["matrix"]) == 3 and len(data["matrix"][0]) == 3
    pairs = {tuple(p["pair"]) for p in data["high_correlation_pairs"]}
    assert ("AAPL", "MSFT") in pairs


@pytest.mark.asyncio
async def test_get_correlation_matrix_too_many_tickers_is_err():
    tickers = [f"T{i}" for i in range(20)]
    out = await at.get_correlation_matrix({"tickers": tickers})
    assert out["ok"] is False
    assert out["error"]["code"] == "too_many_tickers"


@pytest.mark.asyncio
async def test_get_correlation_matrix_no_overlap_is_err(monkeypatch):
    async def fake_loader(symbols, period, frequency):
        return pd.DataFrame()

    monkeypatch.setattr(at, "_corr_returns_frame", fake_loader)
    out = await at.get_correlation_matrix({"tickers": ["AAPL", "MSFT"]})
    assert out["ok"] is False
    assert out["error"]["code"] == "insufficient_history"


# ---------------------------------------------------------------------------
# analyze_pair_trade
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_analyze_pair_trade_happy_path(monkeypatch):
    idx = pd.date_range("2024-01-01", periods=90, freq="B")
    rng = np.random.default_rng(11)
    a = 100 + np.cumsum(rng.normal(0.02, 1.0, 90))
    b = a * 0.5 + rng.normal(0, 0.5, 90)  # cointegrated with A by construction
    frame_a = pd.DataFrame({"Close": a}, index=idx)
    frame_b = pd.DataFrame({"Close": b}, index=idx)

    async def fake_fetcher():
        return _FakeFetcher({"AAA": frame_a, "BBB": frame_b})

    def fake_parse(raw):
        return {"AAA": frame_a, "BBB": frame_b}[raw["_symbol"]]

    monkeypatch.setattr(at, "get_unified_fetcher", fake_fetcher)
    monkeypatch.setattr(at, "_parse_yahoo_chart", fake_parse)

    out = await at.analyze_pair_trade({"ticker_a": "AAA", "ticker_b": "BBB", "period": "1Y"})
    assert out["ok"] is True
    data = out["data"]
    assert data["ticker_a"] == "AAA" and data["ticker_b"] == "BBB"
    assert "signal" in data
    assert data["signal"] in {"LONG_SPREAD", "SHORT_SPREAD", "FLAT", "HOLD"}
    assert len(data["series"]) <= 60


@pytest.mark.asyncio
async def test_analyze_pair_trade_same_ticker_is_err():
    out = await at.analyze_pair_trade({"ticker_a": "AAPL", "ticker_b": "AAPL"})
    assert out["ok"] is False
    assert out["error"]["code"] == "bad_request"


@pytest.mark.asyncio
async def test_analyze_pair_trade_missing_history_is_err(monkeypatch):
    async def fake_fetcher():
        return _FakeFetcher({})  # neither symbol has data

    monkeypatch.setattr(at, "get_unified_fetcher", fake_fetcher)
    out = await at.analyze_pair_trade({"ticker_a": "AAA", "ticker_b": "BBB"})
    assert out["ok"] is False
    assert out["error"]["code"] == "no_price_history"


# ---------------------------------------------------------------------------
# run_factor_analysis
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_factor_analysis_happy_path(monkeypatch):
    tickers = ["A", "B", "C", "D", "E"]
    frames = {t: _price_frame(120, seed=idx) for idx, t in enumerate(tickers)}

    async def fake_fetcher():
        return _FakeFetcher(frames, snapshots={t: {"market_cap": 1e9, "roe_pct": 15.0, "beta": 1.1} for t in tickers})

    def fake_parse(raw):
        return frames[raw["_symbol"]]

    monkeypatch.setattr(at, "get_unified_fetcher", fake_fetcher)
    monkeypatch.setattr(at, "_parse_yahoo_chart", fake_parse)

    out = await at.run_factor_analysis({"tickers": tickers})
    assert out["ok"] is True
    data = out["data"]
    assert data["scope"] == "tickers"
    assert set(data["factor_loadings"]) <= set(at.FactorAttributionEngine.FACTORS)
    assert "attribution" in data


@pytest.mark.asyncio
async def test_run_factor_analysis_too_few_names_is_err(monkeypatch):
    tickers = ["A", "B"]
    frames = {t: _price_frame(120, seed=idx) for idx, t in enumerate(tickers)}

    async def fake_fetcher():
        return _FakeFetcher(frames)

    def fake_parse(raw):
        return frames[raw["_symbol"]]

    monkeypatch.setattr(at, "get_unified_fetcher", fake_fetcher)
    monkeypatch.setattr(at, "_parse_yahoo_chart", fake_parse)

    out = await at.run_factor_analysis({"tickers": tickers})
    assert out["ok"] is False
    assert out["error"]["code"] == "insufficient_universe"


@pytest.mark.asyncio
async def test_run_factor_analysis_empty_portfolio_is_err(monkeypatch):
    class DummyQuery:
        def all(self):
            return []

    class DummyDB:
        def query(self, model):
            return DummyQuery()

        def close(self):
            pass

    monkeypatch.setattr(at, "SessionLocal", lambda: DummyDB())
    out = await at.run_factor_analysis({})
    assert out["ok"] is False
    assert out["error"]["code"] == "empty_portfolio"


# ---------------------------------------------------------------------------
# analyze_execution_quality
# ---------------------------------------------------------------------------

def test_analyze_execution_quality_happy_path():
    out = at.analyze_execution_quality({"period": "1d"})
    assert out["ok"] is True
    assert out["provenance"]["quality"] == "synthetic"  # backing service is a deterministic mock
    assert len(out["data"]["per_trade_stats"]) <= 25
    assert out["data"]["symbol_note"] is None


def test_analyze_execution_quality_with_symbol_notes_limitation():
    out = at.analyze_execution_quality({"symbol": "AAPL"})
    assert out["ok"] is True
    assert out["data"]["symbol_note"] is not None


def test_analyze_execution_quality_engine_failure_is_err(monkeypatch):
    def raise_error(window):
        raise RuntimeError("boom")

    monkeypatch.setattr(at, "generate_tca_report", raise_error)
    out = at.analyze_execution_quality({})
    assert out["ok"] is False
    assert out["error"]["code"] == "tca_error"
