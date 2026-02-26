"""Tests for market calendar module."""
from datetime import datetime, time
from zoneinfo import ZoneInfo

import pytest

from backend.shared.market_calendar import (
    is_extended_hours,
    is_market_open,
    next_market_open,
)

IST = ZoneInfo("Asia/Kolkata")
ET = ZoneInfo("America/New_York")


class TestNSE:
    def test_open_during_session(self):
        dt = datetime(2026, 2, 18, 10, 30, tzinfo=IST)
        assert is_market_open("NSE", dt) is True

    def test_closed_before_open(self):
        dt = datetime(2026, 2, 18, 9, 14, tzinfo=IST)
        assert is_market_open("NSE", dt) is False

    def test_closed_at_boundary(self):
        dt = datetime(2026, 2, 18, 15, 30, tzinfo=IST)
        assert is_market_open("NSE", dt) is False

    def test_open_at_boundary(self):
        dt = datetime(2026, 2, 18, 9, 15, tzinfo=IST)
        assert is_market_open("NSE", dt) is True

    def test_closed_saturday(self):
        dt = datetime(2026, 2, 21, 10, 30, tzinfo=IST)
        assert is_market_open("NSE", dt) is False

    def test_closed_sunday(self):
        dt = datetime(2026, 2, 22, 10, 30, tzinfo=IST)
        assert is_market_open("NSE", dt) is False

    def test_republic_day_holiday(self):
        dt = datetime(2026, 1, 26, 10, 30, tzinfo=IST)
        assert is_market_open("NSE", dt) is False


class TestNYSE:
    def test_open_during_session(self):
        dt = datetime(2026, 2, 18, 11, 0, tzinfo=ET)
        assert is_market_open("NYSE", dt) is True

    def test_pre_market(self):
        dt = datetime(2026, 2, 18, 7, 0, tzinfo=ET)
        assert is_market_open("NYSE", dt) is False
        assert is_extended_hours("NYSE", dt) is True

    def test_after_hours(self):
        dt = datetime(2026, 2, 18, 18, 0, tzinfo=ET)
        assert is_market_open("NYSE", dt) is False
        assert is_extended_hours("NYSE", dt) is True

    def test_closed_mlk_day(self):
        dt = datetime(2026, 1, 19, 11, 0, tzinfo=ET)
        assert is_market_open("NYSE", dt) is False


class TestCME:
    def test_open_overnight(self):
        dt = datetime(2026, 2, 18, 2, 0, tzinfo=ET)
        assert is_market_open("CME", dt) is True

    def test_closed_maintenance(self):
        dt = datetime(2026, 2, 18, 17, 30, tzinfo=ET)
        assert is_market_open("CME", dt) is False


class TestNextMarketOpen:
    def test_next_open_from_after_hours(self):
        dt = datetime(2026, 2, 18, 18, 0, tzinfo=IST)
        nxt = next_market_open("NSE", dt)
        assert nxt.date().isoformat() == "2026-02-19"
        assert nxt.time() == time(9, 15)

    def test_next_open_from_friday_evening(self):
        dt = datetime(2026, 2, 20, 18, 0, tzinfo=IST)
        nxt = next_market_open("NSE", dt)
        assert nxt.weekday() == 0

    def test_unknown_exchange_raises(self):
        with pytest.raises(ValueError, match="Unknown exchange"):
            is_market_open("FAKE", datetime.now())
