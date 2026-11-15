from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.api.routes import quotes as routes


NOW = "2026-11-14T10:00:00+00:00"


def fetcher():
    return SimpleNamespace(
        yahoo=SimpleNamespace(get_quotes=AsyncMock(return_value=[])),
        finnhub=SimpleNamespace(api_key="", get_quote=AsyncMock()),
        kite=SimpleNamespace(api_key="", resolve_access_token=lambda: "", get_quote=AsyncMock()),
    )


def install(monkeypatch, upstream, quote=None):
    monkeypatch.setattr(routes, "get_unified_fetcher", AsyncMock(return_value=upstream))
    monkeypatch.setattr(routes, "get_adapter_registry", lambda: SimpleNamespace(invoke=AsyncMock(return_value=quote)))
    monkeypatch.setattr(routes, "_now_iso", lambda: NOW)


def test_yahoo_distinguishes_missing_change_from_reported_zero_and_preserves_currency():
    upstream = fetcher()
    upstream.yahoo.get_quotes.return_value = [
        {"symbol": "MISS", "regularMarketPrice": 10},
        {"symbol": "ZERO", "regularMarketPrice": 20, "regularMarketChangePercent": 0, "regularMarketTime": 1794643200, "currency": "GBp"},
    ]
    result = asyncio.run(routes._fetch_yahoo_quotes(upstream, ["MISS", "ZERO"], NOW))
    missing, zero = result
    assert missing["changePct"] == zero["changePct"] == 0
    assert missing["change_available"] is False
    assert zero["change_available"] is True
    assert "currency" not in missing
    assert zero["currency"] == "GBp"
    assert missing["ts"] == NOW
    assert missing["timestamp_source"] == "retrieved"
    assert zero["timestamp_source"] == "reported"
    assert zero["ts"] != NOW


def test_invalid_numeric_metadata_does_not_lose_other_quotes():
    upstream = fetcher()
    upstream.yahoo.get_quotes.return_value = [
        {"symbol": "BAD", "regularMarketPrice": float("inf")},
        {"symbol": "VALID", "regularMarketPrice": 20, "regularMarketChangePercent": float("inf"), "regularMarketTime": float("inf"), "currency": "not a currency"},
    ]
    result = asyncio.run(routes._fetch_yahoo_quotes(upstream, ["BAD", "VALID"], NOW))
    assert len(result) == 1
    assert result[0]["symbol"] == "VALID"
    assert result[0]["change_available"] is False
    assert result[0]["timestamp_source"] == "retrieved"
    assert "currency" not in result[0]


def test_finnhub_zero_change_is_reported_without_invented_volume_or_currency(monkeypatch):
    upstream = fetcher()
    upstream.finnhub.api_key = "test-only"
    upstream.finnhub.get_quote.return_value = {"c": 100, "d": 0, "dp": 0, "t": 1794643200}
    install(monkeypatch, upstream)
    result = asyncio.run(routes.get_quotes(market="NASDAQ", symbols="AAPL"))
    quote = result["quotes"][0]
    assert quote["last"] == 100
    assert quote["change_available"] is True
    assert quote["changePct"] == 0
    assert quote["volume"] is None
    assert "currency" not in quote
    assert quote["timestamp_source"] == "reported"


@pytest.mark.parametrize("close,available", [(None, False), (100, True)])
def test_kite_change_availability_comes_from_observed_close(monkeypatch, close, available):
    upstream = fetcher()
    upstream.kite.api_key = "test-only"
    upstream.kite.resolve_access_token = lambda: "test-only"
    upstream.kite.get_quote.return_value = {"data": {"NSE:TCS": {"last_price": 100, "ohlc": {"close": close}}}}
    install(monkeypatch, upstream)
    quote = asyncio.run(routes.get_quotes(market="NSE", symbols="TCS"))["quotes"][0]
    assert quote["changePct"] == 0
    assert quote["change_available"] is available
    assert "currency" not in quote
    assert quote["timestamp_source"] == "retrieved"


@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize("as_dict", [False, True])
def test_adapter_defaults_are_not_claimed_as_observed_metadata(monkeypatch, explicit, as_dict):
    data = {"price": 100, "change": 0, "change_pct": 0, "currency": "USD", "ts": NOW}
    if explicit:
        data["change_available"] = True
    quote = data if as_dict else SimpleNamespace(**data)
    install(monkeypatch, fetcher(), quote)
    result = asyncio.run(routes.get_quotes(market="NASDAQ", symbols="AAPL"))["quotes"][0]
    assert result["change_available"] is explicit
    assert result["changePct"] == 0
    assert result["timestamp_source"] == "adapter"
    assert "currency" not in result


def test_indian_yahoo_fallback_preserves_reported_currency_and_time(monkeypatch):
    upstream = fetcher()
    upstream.yahoo.get_quotes.return_value = [{"symbol": "TCS.NS", "regularMarketPrice": 3200, "regularMarketChangePercent": 0, "currency": "INR", "regularMarketTime": 1794643200}]
    install(monkeypatch, upstream)
    quote = asyncio.run(routes.get_quotes(market="NSE", symbols="TCS"))["quotes"][0]
    assert quote["currency"] == "INR"
    assert quote["timestamp_source"] == "reported"
    assert quote["change_available"] is True
