import pytest

import backend.agent.tools.macro_tools as mt


# ---------------------------------------------------------------------------
# get_economic_calendar
# ---------------------------------------------------------------------------

class FakeEconomicService:
    finnhub_key = None
    fmp_key = None

    def __init__(self, events=None, raise_exc=None):
        self._events = events or []
        self._raise = raise_exc

    async def get_economic_calendar(self, start, end):
        if self._raise:
            raise self._raise
        return self._events


@pytest.mark.asyncio
async def test_get_economic_calendar_happy_path(monkeypatch):
    events = [
        {"date": "2026-01-05", "time": "14:00:00", "country": "US", "event_name": "Non-Farm Payrolls",
         "impact": "high", "actual": None, "forecast": 200000, "previous": 180000, "unit": "Jobs", "currency": "USD"},
        {"date": "2026-01-06", "time": "10:00:00", "country": "IN", "event_name": "CPI",
         "impact": "medium", "actual": None, "forecast": 5.1, "previous": 5.0, "unit": "%", "currency": "INR"},
    ]
    monkeypatch.setattr(
        "backend.services.economic_data.get_economic_data_service",
        lambda: FakeEconomicService(events=events),
    )
    out = await mt.get_economic_calendar({"days": 10})
    assert out["ok"] is True
    assert out["data"]["count"] == 2
    assert out["data"]["events"][0]["event_name"] == "Non-Farm Payrolls"


@pytest.mark.asyncio
async def test_get_economic_calendar_filters_by_country(monkeypatch):
    events = [
        {"date": "2026-01-05", "time": "14:00:00", "country": "US", "event_name": "Non-Farm Payrolls", "impact": "high"},
        {"date": "2026-01-06", "time": "10:00:00", "country": "IN", "event_name": "CPI", "impact": "medium"},
    ]
    monkeypatch.setattr(
        "backend.services.economic_data.get_economic_data_service",
        lambda: FakeEconomicService(events=events),
    )
    out = await mt.get_economic_calendar({"country": "in"})
    assert out["ok"] is True
    assert out["data"]["count"] == 1
    assert out["data"]["events"][0]["country"] == "IN"


@pytest.mark.asyncio
async def test_get_economic_calendar_upstream_failure_returns_err(monkeypatch):
    monkeypatch.setattr(
        "backend.services.economic_data.get_economic_data_service",
        lambda: FakeEconomicService(raise_exc=RuntimeError("provider down")),
    )
    out = await mt.get_economic_calendar({})
    assert out["ok"] is False
    assert "error" in out


# ---------------------------------------------------------------------------
# get_cross_asset_quote
# ---------------------------------------------------------------------------

class _Item:
    def __init__(self, symbol, name, price, change, change_pct, volume, currency="USD", source="yahoo"):
        self.symbol, self.name, self.price = symbol, name, price
        self.change, self.change_pct, self.volume = change, change_pct, volume
        self.currency, self.source = currency, source


class _Category:
    def __init__(self, id_, items):
        self.id = id_
        self.items = items


class _QuotesResp:
    def __init__(self, categories):
        self.categories = categories


class FakeCommodityService:
    async def get_quotes(self):
        return _QuotesResp([_Category("metals", [_Item("GC=F", "Gold", 2000.0, 5.0, 0.25, 1000)])])


@pytest.mark.asyncio
async def test_get_cross_asset_quote_commodity_happy_path(monkeypatch):
    monkeypatch.setattr("backend.services.commodity_service.get_commodities_service", lambda: FakeCommodityService())
    out = await mt.get_cross_asset_quote({"symbol": "gc=f", "asset_class": "commodity"})
    assert out["ok"] is True
    assert out["provenance"]["quality"] == "live"
    assert out["data"]["price"] == 2000.0


@pytest.mark.asyncio
async def test_get_cross_asset_quote_bond_is_synthetic(monkeypatch):
    bonds = [{"isin": "INE001A07ST5", "issuer": "Reliance Industries", "yield": 7.8, "price": 102.5, "rating": "AAA"}]

    class FakeBondService:
        async def get_bond_screener(self, **kwargs):
            return bonds

    monkeypatch.setattr("backend.services.bond_service.get_bond_service", lambda: FakeBondService())
    out = await mt.get_cross_asset_quote({"symbol": "reliance", "asset_class": "bond"})
    assert out["ok"] is True
    assert out["provenance"]["quality"] == "synthetic"
    assert out["data"]["issuer"] == "Reliance Industries"


@pytest.mark.asyncio
async def test_get_cross_asset_quote_no_match_returns_err(monkeypatch):
    monkeypatch.setattr("backend.services.commodity_service.get_commodities_service", lambda: FakeCommodityService())
    out = await mt.get_cross_asset_quote({"symbol": "NOPE", "asset_class": "commodity"})
    assert out["ok"] is False
    assert out["error"]["code"] == "no_data"


@pytest.mark.asyncio
async def test_get_cross_asset_quote_bad_asset_class_returns_err():
    out = await mt.get_cross_asset_quote({"symbol": "AAPL", "asset_class": "equity"})
    assert out["ok"] is False


@pytest.mark.asyncio
async def test_get_cross_asset_quote_upstream_failure_returns_err(monkeypatch):
    class BrokenCommodityService:
        async def get_quotes(self):
            raise RuntimeError("boom")

    monkeypatch.setattr("backend.services.commodity_service.get_commodities_service", lambda: BrokenCommodityService())
    out = await mt.get_cross_asset_quote({"symbol": "GC=F", "asset_class": "commodity"})
    assert out["ok"] is False


# ---------------------------------------------------------------------------
# get_sector_heatmap
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_sector_heatmap_happy_path(monkeypatch):
    async def fake_heatmap_treemap(market, group, period, size_by):
        return {
            "market": market, "group": group, "period": period, "size_by": size_by,
            "data": [
                {"symbol": "RELIANCE", "name": "Reliance", "sector": "Energy", "industry": "Oil", "price": 2500, "change_pct": 3.0, "volume": 1000, "market_cap": 100},
                {"symbol": "TCS", "name": "TCS", "sector": "Technology", "industry": "IT", "price": 3800, "change_pct": -1.0, "volume": 500, "market_cap": 90},
            ],
            "groups": [
                {"name": "Energy", "value": 100, "children": [{"change_pct": 3.0}]},
                {"name": "Technology", "value": 90, "children": [{"change_pct": -1.0}]},
            ],
        }

    monkeypatch.setattr("backend.api.routes.heatmap.heatmap_treemap", fake_heatmap_treemap)
    out = await mt.get_sector_heatmap({"market": "IN", "timeframe": "1d"})
    assert out["ok"] is True
    assert out["data"]["leaders"][0]["symbol"] == "RELIANCE"
    assert out["data"]["laggards"][0]["symbol"] == "TCS"
    assert out["data"]["sectors_ranked"][0]["sector"] == "Energy"


@pytest.mark.asyncio
async def test_get_sector_heatmap_upstream_failure_returns_err(monkeypatch):
    async def failing(market, group, period, size_by):
        raise RuntimeError("boom")

    monkeypatch.setattr("backend.api.routes.heatmap.heatmap_treemap", failing)
    out = await mt.get_sector_heatmap({})
    assert out["ok"] is False


# ---------------------------------------------------------------------------
# get_etf_profile
# ---------------------------------------------------------------------------

class _Holding:
    def __init__(self, symbol, name, weight):
        self.symbol, self.name, self.weight = symbol, name, weight


class _HoldingsResp:
    def __init__(self, holdings):
        self.holdings = holdings


@pytest.mark.asyncio
async def test_get_etf_profile_happy_path(monkeypatch):
    async def fake_holdings(ticker):
        return _HoldingsResp([_Holding("AAPL", "Apple", 7.5), _Holding("MSFT", "Microsoft", 6.8)])

    async def fake_screener(category=None):
        return [{"ticker": "SPY", "expense_ratio": 0.09, "category": "Large Blend", "aum": 500000000000}]

    monkeypatch.setattr("backend.api.routes.etf.etf_holdings", fake_holdings)
    monkeypatch.setattr("backend.api.routes.etf.etf_screener", fake_screener)
    out = await mt.get_etf_profile({"symbol": "spy"})
    assert out["ok"] is True
    assert out["data"]["expense_ratio"] == 0.09
    assert out["data"]["top_holdings"][0]["symbol"] == "AAPL"
    assert out["data"]["top_10_weight_pct"] == 14.3


@pytest.mark.asyncio
async def test_get_etf_profile_upstream_failure_returns_err(monkeypatch):
    async def failing(ticker):
        raise RuntimeError("boom")

    monkeypatch.setattr("backend.api.routes.etf.etf_holdings", failing)
    out = await mt.get_etf_profile({"symbol": "SPY"})
    assert out["ok"] is False


# ---------------------------------------------------------------------------
# get_yield_curve
# ---------------------------------------------------------------------------

class FakeFixedIncomeService:
    def __init__(self, api_key="key", result=None):
        self.api_key = api_key
        self._result = result or {"date": "2026-01-01", "data": [{"label": "2Y", "yield": 4.5}, {"label": "10Y", "yield": 4.1}], "spreads": {"2s10s": -0.4}}

    async def get_yield_curve(self):
        return self._result


@pytest.mark.asyncio
async def test_get_yield_curve_happy_path_flags_inversion(monkeypatch):
    monkeypatch.setattr("backend.services.fixed_income_service.get_fixed_income_service", lambda: FakeFixedIncomeService())
    out = await mt.get_yield_curve({})
    assert out["ok"] is True
    assert out["data"]["inverted_2s10s"] is True
    assert out["provenance"]["quality"] == "live"


@pytest.mark.asyncio
async def test_get_yield_curve_no_api_key_is_synthetic(monkeypatch):
    monkeypatch.setattr(
        "backend.services.fixed_income_service.get_fixed_income_service",
        lambda: FakeFixedIncomeService(api_key=None),
    )
    out = await mt.get_yield_curve({})
    assert out["ok"] is True
    assert out["provenance"]["quality"] == "synthetic"


@pytest.mark.asyncio
async def test_get_yield_curve_unsupported_country_returns_err():
    out = await mt.get_yield_curve({"country": "IN"})
    assert out["ok"] is False
    assert out["error"]["code"] == "unsupported"


@pytest.mark.asyncio
async def test_get_yield_curve_upstream_failure_returns_err(monkeypatch):
    class BrokenService:
        api_key = "key"

        async def get_yield_curve(self):
            raise RuntimeError("boom")

    monkeypatch.setattr("backend.services.fixed_income_service.get_fixed_income_service", lambda: BrokenService())
    out = await mt.get_yield_curve({})
    assert out["ok"] is False


# ---------------------------------------------------------------------------
# Schema sanity
# ---------------------------------------------------------------------------

def test_all_tool_schemas_are_valid_object_schemas():
    specs = mt.macro_tool_specs()
    names = {s.name for s in specs}
    assert names == {"get_economic_calendar", "get_cross_asset_quote", "get_sector_heatmap", "get_etf_profile", "get_yield_curve"}
    for spec in specs:
        assert spec.parameters["type"] == "object"
        assert isinstance(spec.parameters["properties"], dict)
        assert spec.read_only is True
        assert spec.write_class == "none"
        assert spec.description
