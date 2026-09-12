"""Provider chain for the economics terminal: keyed providers -> FXMacroData free tier -> mock."""
import asyncio

import pytest

from backend.services import economic_data
from backend.services.economic_data import EconomicDataService


class FakeFX:
    def __init__(self, calendar=None, indicators=None, fail=False):
        self._calendar = calendar or []
        self._indicators = indicators or {}
        self.fail = fail

    async def get_economic_calendar(self, start, end):
        if self.fail:
            raise RuntimeError("down")
        return list(self._calendar)

    async def get_macro_indicators(self):
        if self.fail:
            raise RuntimeError("down")
        return dict(self._indicators)


@pytest.fixture
def no_cache(monkeypatch):
    async def _get(key):
        return None

    async def _set(key, value, ttl=300):
        return None

    monkeypatch.setattr(economic_data.cache, "get", _get)
    monkeypatch.setattr(economic_data.cache, "set", _set)


@pytest.fixture
def service(no_cache):
    svc = EconomicDataService(fxmacrodata=FakeFX())
    svc.fred_key = svc.finnhub_key = svc.fmp_key = None
    return svc


FX_EVENT = {
    "date": "2026-09-05", "time": "12:30:00", "country": "US", "currency": "USD",
    "event_name": "Non-Farm Payrolls", "impact": "high", "actual": None,
    "forecast": None, "previous": None, "unit": None,
}


def test_calendar_uses_fxmacrodata_free_tier_without_keys(service):
    service.fxmacrodata = FakeFX(calendar=[FX_EVENT])
    events = asyncio.run(service.get_economic_calendar("2026-09-01", "2026-09-30"))
    assert events == [FX_EVENT]


def test_calendar_falls_back_to_mock_when_every_provider_fails(service):
    service.fxmacrodata = FakeFX(fail=True)
    events = asyncio.run(service.get_economic_calendar("2026-09-01", "2026-09-30"))
    assert [e["event_name"] for e in events] == ["Non-Farm Payrolls", "RBI Interest Rate Decision"]


def test_calendar_rejects_invalid_range_from_provider(service):
    class BadRange(FakeFX):
        async def get_economic_calendar(self, start, end):
            raise ValueError("End date must follow start date.")

    service.fxmacrodata = BadRange()
    with pytest.raises(ValueError):
        asyncio.run(service.get_economic_calendar("2026-09-30", "2026-09-01"))


def test_indicators_use_fxmacrodata_us_without_fred(service):
    fx_us = {"policy_rate": {"value": 3.75, "last_value": 4.0, "date": "2026-07-29", "unit": "%", "history": []}}
    service.fxmacrodata = FakeFX(indicators={"us": fx_us})
    result = asyncio.run(service.get_macro_indicators())
    assert result == {"us": {"rate": fx_us["policy_rate"]}}


def test_indicators_merge_fred_regions_with_fxmacrodata_us(service, monkeypatch):
    service.fred_key = "fred"
    fx_us = {"policy_rate": {"value": 3.75, "last_value": 4.0, "date": "2026-07-29", "unit": "%", "history": []}}
    service.fxmacrodata = FakeFX(indicators={"us": fx_us})

    async def fake_fred(region, label, series_id):
        if (region, label) in {("india", "gdp"), ("us", "rate")}:
            return {"region": region, "label": label, "value": 1.0, "last_value": 0.5, "date": "2026-06-30", "history": []}
        return None

    monkeypatch.setattr(service, "_fetch_fred_indicator", fake_fred)
    result = asyncio.run(service.get_macro_indicators())
    assert "india" in result and "us" in result
    # FRED wins on overlap; FXMacroData only fills gaps.
    assert result["us"]["rate"]["value"] == 1.0
    assert "policy_rate" not in result["us"]


def test_indicators_fall_back_to_mock_when_everything_fails(service):
    service.fxmacrodata = FakeFX(fail=True)
    result = asyncio.run(service.get_macro_indicators())
    assert set(result) == {"us", "india"}
