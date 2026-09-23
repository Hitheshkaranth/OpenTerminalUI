"""Tests for the news/events/ownership agent tools (news_tools.py).

Mirrors the monkeypatch-the-module-attribute style of test_agent_market_tools.py:
each handler is a plain module-level async function, so tests patch the
module-level service references it calls rather than mocking HTTP.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import backend.agent.tools.news_tools as nt
from backend.agent.tools.news_tools import news_tool_specs


# ---------------------------------------------------------------------------
# get_news_sentiment
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_news_sentiment_with_symbol(monkeypatch):
    headlines = {"items": [
        {"id": "1", "title": "Headline A", "source": "Reuters", "published_at": "2026-01-01T00:00:00Z",
         "url": "http://a", "summary": "s", "sentiment": {"score": 0.5, "label": "Bullish"}, "tickers": ["TCS"]},
    ]}
    aggregate = {"ticker": "TCS", "overall_label": "Bullish", "average_score": 0.5}

    monkeypatch.setattr(nt, "_get_news_by_ticker", AsyncMock(return_value=headlines))
    monkeypatch.setattr(nt, "_get_news_sentiment_route", AsyncMock(return_value=aggregate))

    out = await nt.get_news_sentiment({"symbol": "tcs", "limit": 10})

    assert out["ok"] is True
    assert out["data"]["symbol"] == "TCS"
    assert out["data"]["headlines"][0]["title"] == "Headline A"
    assert out["data"]["aggregate_read"]["overall_label"] == "Bullish"


@pytest.mark.asyncio
async def test_get_news_sentiment_no_symbol_uses_market_wide(monkeypatch):
    headlines = {"items": [{"id": "1", "title": "Market news", "source": "X", "published_at": "t", "url": "u"}]}
    summary = {"overall_label": "Neutral"}

    fake_latest = AsyncMock(return_value=headlines)
    fake_summary = AsyncMock(return_value=summary)
    monkeypatch.setattr(nt, "_get_latest_news", fake_latest)
    monkeypatch.setattr(nt, "_get_news_sentiment_summary", fake_summary)

    out = await nt.get_news_sentiment({})

    assert out["ok"] is True
    assert out["data"]["symbol"] is None
    fake_latest.assert_awaited_once()
    fake_summary.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_news_sentiment_upstream_failure_returns_err(monkeypatch):
    monkeypatch.setattr(nt, "_get_latest_news", AsyncMock(side_effect=RuntimeError("provider down")))

    out = await nt.get_news_sentiment({})

    assert out["ok"] is False
    assert "error" in out
    assert out["provenance"]["quality"] == "unavailable"


# ---------------------------------------------------------------------------
# get_corporate_events
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_corporate_events_happy_path(monkeypatch):
    result = {
        "items": [{"id": "earnings:TCS:2026-01-15:q3", "type": "earnings", "symbol": "TCS", "date": "2026-01-15"}],
        "errors": [],
    }
    monkeypatch.setattr(nt, "_get_upcoming_events", AsyncMock(return_value=result))

    out = await nt.get_corporate_events({"symbols": ["tcs"], "days": 30})

    assert out["ok"] is True
    assert out["data"]["symbols"] == ["TCS"]
    assert len(out["data"]["items"]) == 1


@pytest.mark.asyncio
async def test_get_corporate_events_requires_symbols():
    out = await nt.get_corporate_events({})
    assert out["ok"] is False
    assert out["error"]["code"] == "invalid_args"


@pytest.mark.asyncio
async def test_get_corporate_events_upstream_failure_returns_err(monkeypatch):
    monkeypatch.setattr(nt, "_get_upcoming_events", AsyncMock(side_effect=RuntimeError("timeout")))

    out = await nt.get_corporate_events({"symbols": ["TCS"]})

    assert out["ok"] is False
    assert "error" in out


# ---------------------------------------------------------------------------
# get_insider_activity
# ---------------------------------------------------------------------------

def _fake_trade(**kwargs) -> SimpleNamespace:
    base = dict(
        date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        symbol="RELIANCE",
        insider_name="Someone",
        insider_title="Director",
        transaction_type="buy",
        shares=100,
        price=10.0,
        value=1000.0,
        source="NSE_FILING",
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_get_insider_activity_happy_path(monkeypatch):
    trades = [
        _fake_trade(transaction_type="buy", value=1000.0),
        _fake_trade(transaction_type="sell", value=400.0, insider_name="Other"),
    ]
    monkeypatch.setattr(nt, "_load_filtered_trades", lambda db, **kw: trades)
    monkeypatch.setattr(nt, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))

    out = await nt.get_insider_activity({"symbol": "reliance", "days": 30})

    assert out["ok"] is True
    assert out["data"]["summary"]["net_direction"] == "buying"
    assert out["data"]["summary"]["net_value"] == pytest.approx(600.0)
    assert out["provenance"]["quality"] == "live"


@pytest.mark.asyncio
async def test_get_insider_activity_flags_synthetic_seeded_data(monkeypatch):
    trades = [_fake_trade(source="SEEDED")]
    monkeypatch.setattr(nt, "_load_filtered_trades", lambda db, **kw: trades)
    monkeypatch.setattr(nt, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))

    out = await nt.get_insider_activity({"symbol": "RELIANCE"})

    assert out["ok"] is True
    assert out["provenance"]["quality"] == "synthetic"


@pytest.mark.asyncio
async def test_get_insider_activity_requires_symbol():
    out = await nt.get_insider_activity({})
    assert out["ok"] is False
    assert out["error"]["code"] == "invalid_args"


@pytest.mark.asyncio
async def test_get_insider_activity_upstream_failure_returns_err(monkeypatch):
    def _raise(db, **kw):
        raise RuntimeError("db down")

    monkeypatch.setattr(nt, "_load_filtered_trades", _raise)
    monkeypatch.setattr(nt, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))

    out = await nt.get_insider_activity({"symbol": "RELIANCE"})

    assert out["ok"] is False


# ---------------------------------------------------------------------------
# get_shareholding_pattern
# ---------------------------------------------------------------------------

class _FakePattern:
    def __init__(self, **kwargs):
        self._data = kwargs

    def model_dump(self):
        return dict(self._data)


@pytest.mark.asyncio
async def test_get_shareholding_pattern_live(monkeypatch):
    pattern = _FakePattern(
        symbol="TCS", quarter="Q3", promoter_holding=72.0, fii_holding=12.0, dii_holding=10.0,
        public_holding=6.0, government_holding=0.0, source="nse", warning=None,
        historical=[
            {"quarter": "Q2", "promoter": 72.0, "fii": 10.0, "dii": 10.0, "public": 8.0, "government": 0.0},
            {"quarter": "Q3", "promoter": 72.0, "fii": 12.0, "dii": 10.0, "public": 6.0, "government": 0.0},
        ],
    )

    class FakeService:
        async def get_shareholding(self, symbol):
            return pattern

    monkeypatch.setattr(nt, "ShareholdingService", FakeService)

    out = await nt.get_shareholding_pattern({"symbol": "tcs"})

    assert out["ok"] is True
    assert out["data"]["qoq_change"]["fii"] == pytest.approx(2.0)
    assert out["provenance"]["quality"] == "live"


@pytest.mark.asyncio
async def test_get_shareholding_pattern_synthetic_on_fallback(monkeypatch):
    pattern = _FakePattern(
        symbol="AAPL", quarter="Latest", promoter_holding=0.0, fii_holding=0.0, dii_holding=0.0,
        public_holding=100.0, government_holding=0.0, source="fallback", warning="non-NSE", historical=[],
    )

    class FakeService:
        async def get_shareholding(self, symbol):
            return pattern

    monkeypatch.setattr(nt, "ShareholdingService", FakeService)

    out = await nt.get_shareholding_pattern({"symbol": "AAPL"})

    assert out["ok"] is True
    assert out["provenance"]["quality"] == "synthetic"


@pytest.mark.asyncio
async def test_get_shareholding_pattern_requires_symbol():
    out = await nt.get_shareholding_pattern({})
    assert out["ok"] is False


@pytest.mark.asyncio
async def test_get_shareholding_pattern_upstream_failure_returns_err(monkeypatch):
    class FakeService:
        async def get_shareholding(self, symbol):
            raise RuntimeError("NSE unreachable")

    monkeypatch.setattr(nt, "ShareholdingService", FakeService)

    out = await nt.get_shareholding_pattern({"symbol": "TCS"})

    assert out["ok"] is False


# ---------------------------------------------------------------------------
# get_dividend_history
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_dividend_history_always_synthetic(monkeypatch):
    rows = [
        {"date": "2025-08-10", "amount": 9.0},
        {"date": "2020-08-12", "amount": 8.5},
    ]
    monkeypatch.setattr(nt, "_get_dividend_history_route", AsyncMock(return_value=rows))

    out = await nt.get_dividend_history({"symbol": "reliance"})

    assert out["ok"] is True
    assert out["provenance"]["quality"] == "synthetic"
    assert len(out["data"]["payouts"]) == 2


@pytest.mark.asyncio
async def test_get_dividend_history_years_filter(monkeypatch):
    rows = [
        {"date": "2025-08-10", "amount": 9.0},
        {"date": "2015-08-12", "amount": 8.5},
    ]
    monkeypatch.setattr(nt, "_get_dividend_history_route", AsyncMock(return_value=rows))

    out = await nt.get_dividend_history({"symbol": "RELIANCE", "years": 3})

    assert out["ok"] is True
    dates = [p["date"] for p in out["data"]["payouts"]]
    assert "2015-08-12" not in dates


@pytest.mark.asyncio
async def test_get_dividend_history_requires_symbol():
    out = await nt.get_dividend_history({})
    assert out["ok"] is False


@pytest.mark.asyncio
async def test_get_dividend_history_upstream_failure_returns_err(monkeypatch):
    monkeypatch.setattr(nt, "_get_dividend_history_route", AsyncMock(side_effect=RuntimeError("boom")))

    out = await nt.get_dividend_history({"symbol": "RELIANCE"})

    assert out["ok"] is False


# ---------------------------------------------------------------------------
# Spec-level sanity
# ---------------------------------------------------------------------------

def test_news_tool_specs_returns_five():
    specs = news_tool_specs("any-user")
    names = [s.name for s in specs]
    assert names == [
        "get_news_sentiment",
        "get_corporate_events",
        "get_insider_activity",
        "get_shareholding_pattern",
        "get_dividend_history",
    ]


def test_news_tools_are_read_only():
    for spec in news_tool_specs("any-user"):
        assert spec.read_only is True
        assert spec.write_class == "none"


def test_news_tool_specs_have_valid_json_schema():
    for spec in news_tool_specs("any-user"):
        params = spec.parameters
        assert params["type"] == "object"
        assert isinstance(params["properties"], dict)
        for required_field in params.get("required", []):
            assert required_field in params["properties"], f"{spec.name}: {required_field} not in properties"
        assert spec.description and len(spec.description) > 20
        # to_def() must not raise — this is what the LLM provider actually receives.
        tool_def = spec.to_def()
        assert tool_def.name == spec.name
