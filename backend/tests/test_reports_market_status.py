from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from backend.reports import routes


class _FakeNse:
    def __init__(self, market_state=None, fail=False):
        self.market_state = market_state or []
        self.fail = fail

    async def get_market_status(self):
        if self.fail:
            raise RuntimeError("blocked")
        return {"marketState": self.market_state}

    async def get_index_quote(self, _name):
        if self.fail:
            raise RuntimeError("blocked")
        return {"data": [{"index": "NIFTY 50", "last": 25000.5, "pChange": 0.4}]}


class _FakeYahoo:
    def __init__(self, rows=None, fail=False):
        self.rows = rows or []
        self.fail = fail

    async def get_quotes(self, _symbols):
        if self.fail:
            raise RuntimeError("rate limited")
        return self.rows


def _patch(monkeypatch, nse, yahoo):
    fetcher = SimpleNamespace(nse=nse, yahoo=yahoo)

    async def _fake():
        return fetcher

    monkeypatch.setattr(routes, "get_unified_fetcher", _fake)


def test_market_status_uses_real_commodity_quotes_and_never_fabricates(monkeypatch):
    monkeypatch.setattr(routes, "_LAST_GOOD_TICKERS", {})
    rows = [
        {"symbol": "GC=F", "regularMarketPrice": 4326.1, "regularMarketChangePercent": 0.5},
        {"symbol": "USDINR=X", "regularMarketPrice": 95.95, "regularMarketChangePercent": 0.1},
    ]
    _patch(monkeypatch, _FakeNse(), _FakeYahoo(rows))
    payload = asyncio.run(routes.market_status())
    assert payload["gold"] == 4326.1
    assert payload["usdInr"] == 95.95
    # Silver/crude not returned by any provider: null + flagged, not a hardcoded mock.
    assert payload["silver"] is None and payload["silverPct"] is None
    assert "silver" in payload["unavailable"] and "crude" in payload["unavailable"]
    assert payload["fallbackEnabled"] is True

    # Provider outage: last real values are served flagged stale, unchanged (no noise).
    _patch(monkeypatch, _FakeNse(fail=True), _FakeYahoo(fail=True))
    payload = asyncio.run(routes.market_status())
    assert payload["gold"] == 4326.1
    assert payload["usdInr"] == 95.95
    assert payload["nifty50"] == 25000.5
    assert {"gold", "usdInr", "nifty50"} <= set(payload["stale"])
    assert payload["sp500"] is None and "sp500" in payload["unavailable"]


def test_market_status_reports_exchange_hours(monkeypatch):
    monkeypatch.setattr(routes, "_LAST_GOOD_TICKERS", {})
    calls = []

    def _fake_open(exchange):
        calls.append(exchange)
        return exchange == "NYSE"

    monkeypatch.setattr(routes, "is_market_open", _fake_open)
    _patch(monkeypatch, _FakeNse([{"market": "Currency", "marketStatus": "Open"}]), _FakeYahoo())
    payload = asyncio.run(routes.market_status())
    assert payload["nseStatus"] == "CLOSED"
    assert payload["nyseStatus"] == "OPEN"


def test_nse_closed_inside_hours_when_capital_market_reports_close(monkeypatch):
    monkeypatch.setattr(routes, "_LAST_GOOD_TICKERS", {})
    monkeypatch.setattr(routes, "is_market_open", lambda _ex: True)
    state = [{"market": "Capital Market", "marketStatus": "Close"}]
    _patch(monkeypatch, _FakeNse(state), _FakeYahoo())
    payload = asyncio.run(routes.market_status())
    assert payload["nseStatus"] == "CLOSED"


def test_nse_is_closed_before_0915_ist():
    from backend.shared.market_calendar import is_market_open

    # Thursday 2026-09-24 08:10 IST — pre-open, must be closed.
    assert is_market_open("NSE", datetime(2026, 9, 24, 8, 10, tzinfo=ZoneInfo("Asia/Kolkata"))) is False
