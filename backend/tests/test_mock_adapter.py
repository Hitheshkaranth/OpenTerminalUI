"""Tests for MockDataAdapter."""
import asyncio
from datetime import date, timedelta

import pytest

from backend.adapters.mock import MockDataAdapter


@pytest.fixture
def adapter():
    return MockDataAdapter(seed=42)


def test_get_quote(adapter):
    result = asyncio.run(
        adapter.get_quote("NSE:NIFTY 50")
    )
    assert result is not None
    assert result.symbol == "NSE:NIFTY 50"
    assert 20_000 < result.price < 25_000
    assert result.currency == "INR"


def test_get_history(adapter):
    result = asyncio.run(
        adapter.get_history("NASDAQ:AAPL", "1d", date(2025, 1, 1), date(2025, 3, 1))
    )
    assert len(result) > 30
    for candle in result:
        assert candle.h >= candle.l
        assert candle.v > 0


def test_get_option_chain(adapter):
    expiry = date.today() + timedelta(days=7)
    chain = asyncio.run(
        adapter.get_option_chain("NIFTY 50", expiry)
    )
    assert chain is not None
    assert chain.spot_price > 0
    assert len(chain.contracts) > 20
    assert chain.pcr_oi > 0
    assert chain.max_pain is not None

    types = {c.option_type for c in chain.contracts}
    assert "CE" in types
    assert "PE" in types


def test_get_futures_chain(adapter):
    result = asyncio.run(
        adapter.get_futures_chain("NIFTY 50")
    )
    assert len(result) == 3
    for c in result:
        assert c.basis >= 0
        assert c.oi > 0


def test_max_pain_is_valid_strike(adapter):
    expiry = date.today() + timedelta(days=14)
    chain = asyncio.run(
        adapter.get_option_chain("NIFTY 50", expiry)
    )
    all_strikes = {c.strike for c in chain.contracts}
    assert chain.max_pain in all_strikes


def test_search(adapter):
    result = asyncio.run(
        adapter.search_instruments("AAPL")
    )
    assert len(result) >= 1
    assert "AAPL" in result[0].symbol


def test_deterministic_with_same_seed():
    a1 = MockDataAdapter(seed=99)
    a2 = MockDataAdapter(seed=99)
    q1 = asyncio.run(a1.get_quote("NSE:INFY"))
    q2 = asyncio.run(a2.get_quote("NSE:INFY"))
    assert q1.price == q2.price
