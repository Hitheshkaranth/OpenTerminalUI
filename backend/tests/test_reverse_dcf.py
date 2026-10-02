from __future__ import annotations

import asyncio

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from backend.valuation import reverse_dcf as rd
from backend.valuation import routes as val_routes


def _yahoo_series(values, dates):
    return {
        "timestamp": list(range(len(values))),
        "value": [{"asOfDate": date, "reportedValue": {"raw": value}} for date, value in zip(dates, values)],
    }


def _sample_financials():
    return {
        "yahoo_fundamentals": {
            "annualTotalRevenue": _yahoo_series(
                [100, 110, 121, 133, 146, 161], ["2018-03-31", "2019-03-31", "2020-03-31", "2021-03-31", "2022-03-31", "2023-03-31"]
            ),
            "annualNetIncome": _yahoo_series(
                [10, 12, 14, 16, 18, 21], ["2018-03-31", "2019-03-31", "2020-03-31", "2021-03-31", "2022-03-31", "2023-03-31"]
            ),
            "annualFreeCashFlow": _yahoo_series(
                [100, 110, 121, 133, 146, 161], ["2018-03-31", "2019-03-31", "2020-03-31", "2021-03-31", "2022-03-31", "2023-03-31"]
            ),
            "annualNetDebt": _yahoo_series([500], ["2023-03-31"]),
        },
        "fmp_income": [],
        "fmp_balance": [],
        "fmp_cashflow": [],
    }


def test_closed_form_recovers_growth():
    cf0, r, g_t, n, g_true = 1500.0, 0.12, 0.03, 10, 0.085
    ev = rd.projected_ev(cf0, r, g_true, g_t, n)
    recovered = rd.solve_implied_growth(cf0, r, g_t, n, ev)
    assert recovered is not None
    assert abs(recovered - g_true) < 1e-4


def test_implied_growth_zero_terminal_growth_matches_simple_dcf():
    cf0, r, n, g_true = 800.0, 0.10, 5, 0.05
    ev = rd.projected_ev(cf0, r, g_true, 0.0, n)
    recovered = rd.solve_implied_growth(cf0, r, 0.0, n, ev)
    assert recovered is not None
    assert abs(recovered - g_true) < 1e-4


def test_cf0_nonpositive_returns_none():
    assert rd.solve_implied_growth(0.0, 0.12, 0.03, 10, 1000) is None
    assert rd.solve_implied_growth(-5.0, 0.12, 0.03, 10, 1000) is None


def test_discount_rate_le_terminal_growth_returns_none():
    assert rd.solve_implied_growth(1500.0, 0.02, 0.05, 10, 1000) is None


def test_no_solution_outside_range_returns_none():
    cf0, r, g_t, n = 1500.0, 0.12, 0.03, 10
    ev_at_max = rd.projected_ev(cf0, r, 1.0, g_t, n)
    assert rd.solve_implied_growth(cf0, r, g_t, n, ev_at_max * 3.0) is None


def test_solve_requires_positive_enterprise_value():
    assert rd.solve_implied_growth(1500.0, 0.12, 0.03, 10, 0) is None
    assert rd.solve_implied_growth(1500.0, 0.12, 0.03, 10, -100) is None


@pytest.mark.parametrize(
    "implied,hist,expected",
    [
        (0.20, 0.05, "priced_for_perfection"),  # 15pp
        (0.10, 0.06, "demanding"),  # 4pp
        (0.13, 0.05, "demanding"),  # 8pp
        (0.15, 0.05, "demanding"),  # 10pp boundary -> demanding
        (0.06, 0.05, "reasonable"),  # 1pp
        (0.08, 0.05, "demanding"),  # 3pp boundary -> demanding
        (0.079, 0.05, "reasonable"),  # 2.9pp
        (0.03, 0.08, "reasonable"),  # -5pp boundary -> reasonable
        (0.02, 0.08, "undemanding"),  # -6pp
    ],
)
def test_verdict_thresholds(implied, hist, expected):
    assert rd.verdict_for(implied, hist) == expected


def test_historical_cagr_uses_longer_horizon_available():
    from datetime import datetime

    revenue = [
        (datetime(2015, 1, 1), 100.0),
        (datetime(2016, 1, 1), 110.0),
        (datetime(2017, 1, 1), 121.0),
        (datetime(2018, 1, 1), 133.0),
        (datetime(2019, 1, 1), 146.0),
        (datetime(2020, 1, 1), 160.0),
    ]
    hc = rd.historical_cagr(revenue, [])
    assert hc["revenue_cagr_5y"] is not None
    assert hc["revenue_cagr_3y"] is not None
    assert hc["revenue_cagr_5y"] > 0


def test_build_reverse_dcf_full_shape():
    cf0, r, gt, n = 161.0, 0.12, 0.03, 10
    target_ev = rd.projected_ev(cf0, r, 0.08, gt, n)  # implies ~8% growth
    result = rd.build_reverse_dcf(
        "reliance",
        price=2500.0,
        market_cap=target_ev - 500.0,
        currency="INR",
        financials=_sample_financials(),
        discount_rate=0.12,
        terminal_growth=0.03,
        years=10,
        basis="fcf",
    )
    assert result["symbol"] == "RELIANCE"
    assert result["currency"] == "INR"
    assert result["basis"] == "fcf"
    assert result["base_cash_flow"] == 161.0
    assert result["net_debt"] == 500.0
    assert result["implied_growth_pct"] is not None
    assert 5 < result["implied_growth_pct"] < 12
    assert result["verdict"] in {"priced_for_perfection", "demanding", "reasonable", "undemanding"}
    sens = result["sensitivity"]
    assert len(sens["discount_rates"]) == 5
    assert len(sens["terminal_growths"]) == 5
    assert len(sens["implied_growth_pct"]) == 5
    assert all(len(row) == 5 for row in sens["implied_growth_pct"])
    assert isinstance(result["notes"], list) and result["notes"]
    # net debt fallback / 3y historical populated
    assert result["historical"]["revenue_cagr_5y"] is not None


def test_build_reverse_dcf_cf0_nonpositive_is_not_meaningful():
    fin = _sample_financials()
    fin["yahoo_fundamentals"]["annualFreeCashFlow"] = _yahoo_series([-10, -20, -30], ["2021-03-31", "2022-03-31", "2023-03-31"])
    result = rd.build_reverse_dcf(
        "ACME", price=10.0, market_cap=100.0, currency="INR", financials=fin,
        discount_rate=0.12, terminal_growth=0.03, years=10, basis="fcf",
    )
    assert result["implied_growth_pct"] is None
    assert result["verdict"] == "not_meaningful"
    assert any("non-positive" in n.lower() for n in result["notes"])


def test_build_reverse_dcf_r_le_tg_is_not_meaningful():
    result = rd.build_reverse_dcf(
        "ACME", price=10.0, market_cap=100.0, currency="INR", financials=_sample_financials(),
        discount_rate=0.02, terminal_growth=0.05, years=10, basis="fcf",
    )
    assert result["implied_growth_pct"] is None
    assert result["verdict"] == "not_meaningful"
    assert any("greater than" in n.lower() for n in result["notes"])


def test_basis_net_income_uses_profit_stream():
    result = rd.build_reverse_dcf(
        "ACME", price=10.0, market_cap=100.0, currency="INR", financials=_sample_financials(),
        discount_rate=0.12, terminal_growth=0.03, years=10, basis="net_income",
    )
    assert result["basis"] == "net_income"
    assert result["base_cash_flow"] == 21.0  # latest net income in the sample


def _make_app():
    app = FastAPI()
    from backend.valuation.routes import router as valuation_router

    app.include_router(valuation_router)
    return app


class _FakeFetcher:
    def __init__(self, financials):
        self.financials = financials

    async def fetch_10yr_financials(self, symbol):
        return self.financials


def test_reverse_dcf_route_with_services_monkeypatched(monkeypatch):
    target_ev = rd.projected_ev(161.0, 0.12, 0.08, 0.03, 10)  # implies ~8% growth
    snapshot = {"current_price": 2500.0, "market_cap": target_ev - 500.0, "currency": "INR"}

    async def _fake_snapshot(ticker):
        return snapshot

    async def _fake_get_unified_fetcher():
        return _FakeFetcher(_sample_financials())

    monkeypatch.setattr(val_routes, "fetch_stock_snapshot_coalesced", _fake_snapshot)
    monkeypatch.setattr(val_routes, "get_unified_fetcher", _fake_get_unified_fetcher)

    client = TestClient(_make_app())
    resp = client.get("/api/valuation/RELIANCE/reverse-dcf", params={"discount_rate": 0.12, "terminal_growth": 0.03, "years": 10})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["symbol"] == "RELIANCE"
    assert payload["market_cap"] == target_ev - 500.0
    assert payload["implied_growth_pct"] is not None
    assert 5 < payload["implied_growth_pct"] < 12


def test_reverse_dcf_route_validation_422(monkeypatch):
    async def _fake_snapshot(ticker):
        return {"currency": "INR"}

    async def _fake_get_unified_fetcher():
        return _FakeFetcher(_sample_financials())

    monkeypatch.setattr(val_routes, "fetch_stock_snapshot_coalesced", _fake_snapshot)
    monkeypatch.setattr(val_routes, "get_unified_fetcher", _fake_get_unified_fetcher)

    client = TestClient(_make_app())
    # discount rate out of range
    r = client.get("/api/valuation/RELIANCE/reverse-dcf", params={"discount_rate": 0.9, "terminal_growth": 0.03, "years": 10})
    assert r.status_code == 422
    # years out of range
    r = client.get("/api/valuation/RELIANCE/reverse-dcf", params={"discount_rate": 0.12, "terminal_growth": 0.03, "years": 99})
    assert r.status_code == 422
    # bad basis
    r = client.get("/api/valuation/RELIANCE/reverse-dcf", params={"discount_rate": 0.12, "terminal_growth": 0.03, "years": 10, "basis": "ebitda"})
    assert r.status_code == 422


def test_reverse_dcf_route_no_market_cap_not_meaningful(monkeypatch):
    async def _fake_snapshot(ticker):
        return {"current_price": None, "market_cap": None, "currency": "INR"}

    async def _fake_get_unified_fetcher():
        return _FakeFetcher(_sample_financials())

    monkeypatch.setattr(val_routes, "fetch_stock_snapshot_coalesced", _fake_snapshot)
    monkeypatch.setattr(val_routes, "get_unified_fetcher", _fake_get_unified_fetcher)

    client = TestClient(_make_app())
    r = client.get("/api/valuation/RELIANCE/reverse-dcf", params={"discount_rate": 0.12, "terminal_growth": 0.03, "years": 10})
    assert r.status_code == 200
    payload = r.json()
    assert payload["verdict"] == "not_meaningful"
    assert payload["implied_growth_pct"] is None