from __future__ import annotations

import asyncio
import sys
from datetime import date, timedelta

import pytest

from backend.equity.services.earnings import QuarterlyFinancial
from backend.results_tracker import routes, service


def _fin(
    symbol: str,
    period_end: date,
    *,
    revenue: float,
    net_profit: float,
    ebitda: float | None = None,
    eps: float | None = None,
    period: str,
) -> QuarterlyFinancial:
    return QuarterlyFinancial(
        symbol=symbol,
        quarter=period,
        quarter_end_date=period_end,
        revenue=revenue,
        net_profit=net_profit,
        ebitda=ebitda,
        eps=eps,
    )


@pytest.fixture(autouse=True)
def _no_network(monkeypatch) -> None:
    # The earnings calendar (estimates) must never touch the network in tests.
    async def _fake_calendar(from_date=None, to_date=None, symbols=None):  # noqa: ANN001, ARG001
        return []

    monkeypatch.setattr(service.earnings_service, "get_earnings_calendar", _fake_calendar)


def _patch_quarterly(monkeypatch, rows: list[QuarterlyFinancial]) -> None:
    async def _fake(symbol: str, quarters: int = 12):  # noqa: ANN001
        return rows

    monkeypatch.setattr(service.earnings_service, "get_quarterly_financials", _fake)


# --------------------------------------------------------------------------- #
# YoY matching by period end
# --------------------------------------------------------------------------- #
def test_yoy_by_date_matches_the_same_quarter_a_year_earlier(monkeypatch) -> None:
    rows = [
        _fin("ACC", date(2022, 9, 30), revenue=110.0, net_profit=11.0, ebitda=16.0, period="Q1 FY23"),
        _fin("ACC", date(2022, 12, 31), revenue=130.0, net_profit=13.0, ebitda=18.0, period="Q2 FY23"),
        _fin("ACC", date(2023, 9, 30), revenue=200.0, net_profit=25.0, ebitda=28.0, period="Q1 FY24"),
        _fin("ACC", date(2023, 12, 31), revenue=210.0, net_profit=26.0, ebitda=29.0, period="Q2 FY24"),
    ]
    _patch_quarterly(monkeypatch, rows)

    out = asyncio.run(service.build_history("ACC", quarters=8))
    latest = out["quarters"][0]
    assert latest["period_end"] == "2023-12-31"
    assert latest["revenue_yoy_pct"] == pytest.approx((210 - 130) / 130 * 100)
    assert latest["profit_yoy_pct"] == pytest.approx((26 - 13) / 13 * 100)
    assert latest["ebitda_margin_pct"] == pytest.approx(29.0 / 210 * 100)
    assert latest["net_margin_pct"] == pytest.approx(26.0 / 210 * 100)


def test_yoy_missing_quarter_yields_null_not_shifted(monkeypatch) -> None:
    # 2023-09-30 has a 2022-09-30 gap; the 2021-09-30 quarter must NOT be used.
    rows = [
        _fin("ACC", date(2021, 9, 30), revenue=100.0, net_profit=10.0, ebitda=15.0, period="Q1 FY22"),
        _fin("ACC", date(2022, 12, 31), revenue=110.0, net_profit=11.0, ebitda=16.0, period="Q2 FY23"),
        _fin("ACC", date(2023, 9, 30), revenue=150.0, net_profit=20.0, ebitda=22.0, period="Q1 FY24"),
    ]
    _patch_quarterly(monkeypatch, rows)

    out = asyncio.run(service.build_history("ACC", quarters=8))
    latest = out["quarters"][0]
    # No quarter within +-45 days of 2022-09-30 exists, so YoY must be None,
    # NOT shifted to the 2021-09-30 quarter (two years earlier).
    assert latest["revenue_yoy_pct"] is None
    assert latest["profit_yoy_pct"] is None


def test_qoq_uses_previous_reported_quarter(monkeypatch) -> None:
    rows = [
        _fin("ACC", date(2023, 3, 31), revenue=130.0, net_profit=13.0, ebitda=18.0, period="Q2 FY23"),
        _fin("ACC", date(2023, 9, 30), revenue=170.0, net_profit=24.0, ebitda=28.0, period="Q1 FY24"),
    ]
    _patch_quarterly(monkeypatch, rows)

    out = asyncio.run(service.build_history("ACC", quarters=8))
    latest = out["quarters"][0]
    assert latest["revenue_qoq_pct"] == pytest.approx((170 - 130) / 130 * 100)
    assert latest["profit_qoq_pct"] == pytest.approx((24 - 13) / 13 * 100)


# --------------------------------------------------------------------------- #
# Scorecard rules
# --------------------------------------------------------------------------- #
def test_scorecard_strong() -> None:
    card = service.evaluate_scorecard(revenue_yoy=20.0, profit_yoy=18.0, num_quarters=8)
    assert card.label == "strong"
    assert card.reasons


def test_scorecard_weak() -> None:
    assert service.evaluate_scorecard(revenue_yoy=-5.0, profit_yoy=-10.0, num_quarters=8).label == "weak"


def test_scorecard_mixed_signs_differ() -> None:
    assert service.evaluate_scorecard(10.0, -3.0, 8).label == "mixed"
    assert service.evaluate_scorecard(-3.0, 10.0, 8).label == "mixed"


def test_scorecard_steady_when_thresholds_not_met() -> None:
    assert service.evaluate_scorecard(revenue_yoy=3.0, profit_yoy=2.0, num_quarters=8).label == "steady"
    assert service.evaluate_scorecard(revenue_yoy=None, profit_yoy=None, num_quarters=8).label == "steady"


def test_scorecard_insufficient_data_below_five_quarters() -> None:
    assert service.evaluate_scorecard(revenue_yoy=50.0, profit_yoy=60.0, num_quarters=4).label == "insufficient_data"


def test_scorecard_built_into_history(monkeypatch) -> None:
    rows = [
        _fin("STR", date(2021, 9, 30), revenue=100.0, net_profit=10.0, period="Q1 FY22"),
        _fin("STR", date(2021, 12, 31), revenue=110.0, net_profit=11.0, period="Q2 FY22"),
        _fin("STR", date(2022, 3, 31), revenue=120.0, net_profit=12.0, period="Q3 FY22"),
        _fin("STR", date(2022, 6, 30), revenue=130.0, net_profit=13.0, period="Q4 FY22"),
        _fin("STR", date(2022, 9, 30), revenue=175.0, net_profit=18.0, period="Q1 FY23"),
    ]
    _patch_quarterly(monkeypatch, rows)

    out = asyncio.run(service.build_history("STR", quarters=8))
    # 5 quarters available, strong growth vs the same quarter a year earlier.
    assert out["scorecard"]["label"] == "strong"


# --------------------------------------------------------------------------- #
# History shape
# --------------------------------------------------------------------------- #
def test_history_trims_to_requested_quarters(monkeypatch) -> None:
    rows = [
        _fin("ACC", date(2022, 3, 31), revenue=100.0, net_profit=10.0, period="Q3 FY22"),
        _fin("ACC", date(2022, 6, 30), revenue=101.0, net_profit=11.0, period="Q4 FY22"),
        _fin("ACC", date(2022, 9, 30), revenue=102.0, net_profit=12.0, period="Q1 FY23"),
        _fin("ACC", date(2022, 12, 31), revenue=103.0, net_profit=13.0, period="Q2 FY23"),
        _fin("ACC", date(2023, 3, 31), revenue=104.0, net_profit=14.0, period="Q3 FY23"),
        _fin("ACC", date(2023, 6, 30), revenue=105.0, net_profit=15.0, period="Q4 FY23"),
    ]
    _patch_quarterly(monkeypatch, rows)

    out = asyncio.run(service.build_history("ACC", quarters=3))
    assert out["symbol"] == "ACC"
    assert [q["period"] for q in out["quarters"]] == ["Q4 FY23", "Q3 FY23", "Q2 FY23"]
    assert out["scorecard"]["label"] in (
        "strong",
        "steady",
        "weak",
        "mixed",
        "insufficient_data",
    )


def test_history_flags_empty_source_with_warning(monkeypatch) -> None:
    _patch_quarterly(monkeypatch, rows=[])
    out = asyncio.run(service.build_history("EMPTY", quarters=4))
    assert out["quarters"] == []
    assert out["scorecard"]["label"] == "insufficient_data"
    assert any("unavailable" in w for w in out["warnings"])


# --------------------------------------------------------------------------- #
# Latest: only symbols that reported within the 14-day window
# --------------------------------------------------------------------------- #
def test_latest_reports_only_recent_events(monkeypatch) -> None:
    today = date.today()

    class _Ev:
        def __init__(self, symbol: str, name: str, dt: date) -> None:
            self.symbol = symbol
            self.company_name = name
            self.earnings_date = dt

    recent = _Ev("RELIANCE", "Reliance", today - timedelta(days=3))
    old = _Ev("OLD", "Old Corp", today - timedelta(days=40))

    async def _fake_calendar(from_date=None, to_date=None, symbols=None):  # noqa: ANN001, ARG001
        return [recent, old]

    def _q(dt: date, rev: float) -> QuarterlyFinancial:
        return QuarterlyFinancial(
            symbol="RELIANCE",
            quarter="Q1 FY24",
            quarter_end_date=dt,
            revenue=rev,
            net_profit=rev * 0.1,
            ebitda=rev * 0.15,
            eps=2.0,
        )

    rows = [
        _q(today - timedelta(days=6), 100.0),
        _q(today - timedelta(days=40), 95.0),
        _q(today - timedelta(days=75), 90.0),
        _q(today - timedelta(days=120), 85.0),
        _q(today - timedelta(days=180), 80.0),
    ]

    async def _fake_quarterly(symbol: str, quarters: int = 12):  # noqa: ANN001
        return rows

    monkeypatch.setattr(service.earnings_service, "get_earnings_calendar", _fake_calendar)
    monkeypatch.setattr(service.earnings_service, "get_quarterly_financials", _fake_quarterly)

    out = asyncio.run(service.get_latest("IN", limit=10))
    symbols = [r["symbol"] for r in out["items"]]
    assert "RELIANCE" in symbols
    assert "OLD" not in symbols  # outside the 14-day window
    assert out["market"] == "IN"

    reliance = next(r for r in out["items"] if r["symbol"] == "RELIANCE")
    assert reliance["scorecard"] in ("strong", "steady", "weak", "mixed", "insufficient_data")
    assert reliance["period"]
    assert reliance["announced_at"]


# --------------------------------------------------------------------------- #
# Routes (service monkeypatched)
# --------------------------------------------------------------------------- #
def test_history_route_calls_service(monkeypatch) -> None:
    captured: dict = {}

    async def _fake_history(symbol: str, quarters: int = 8):  # noqa: ANN001
        captured["symbol"] = symbol
        captured["quarters"] = quarters
        return {"symbol": symbol, "quarters": [], "scorecard": {"label": "steady", "reasons": []}, "warnings": []}

    monkeypatch.setattr(service, "build_history", _fake_history)
    out = asyncio.run(routes.get_results_history("RELIANCE", quarters=6))
    assert captured == {"symbol": "RELIANCE", "quarters": 6}
    assert out["symbol"] == "RELIANCE"


def test_history_route_clamps_quarters(monkeypatch) -> None:
    captured: dict = {}

    async def _fake_history(symbol: str, quarters: int = 8):  # noqa: ANN001
        captured["quarters"] = quarters
        return {"symbol": symbol, "quarters": [], "scorecard": {"label": "steady", "reasons": []}, "warnings": []}

    monkeypatch.setattr(service, "build_history", _fake_history)
    asyncio.run(routes.get_results_history("RELIANCE", quarters=999))
    assert captured["quarters"] == 24


def test_latest_route_returns_items(monkeypatch) -> None:
    fake_latest = {
        "market": "IN",
        "items": [
            {
                "symbol": "RELIANCE",
                "name": "Reliance Industries",
                "period": "Q1 FY24",
                "announced_at": "2023-07-19",
                "revenue_yoy_pct": 12.5,
                "profit_yoy_pct": 8.0,
                "eps_surprise_pct": None,
                "scorecard": "steady",
            }
        ],
        "warnings": [],
        "updated_at": "2024-01-01",
    }

    async def _fake_latest(market: str = "IN", limit: int = 50):  # noqa: ANN001
        return fake_latest

    monkeypatch.setattr(service, "get_latest", _fake_latest)
    out = asyncio.run(routes.get_results_latest(market="IN", limit=10))
    assert out["market"] == "IN"
    assert out["items"][0]["symbol"] == "RELIANCE"


def test_latest_route_normalises_unknown_market(monkeypatch) -> None:
    seen: dict | None = None

    async def _fake_latest(market: str = "IN", limit: int = 50):  # noqa: ANN001
        nonlocal seen
        seen = {"market": market}
        return seen

    monkeypatch.setattr(service, "get_latest", _fake_latest)
    asyncio.run(routes.get_results_latest(market="NASDAQ", limit=3))
    assert seen["market"] == "US"


if __name__ == "__main__":  # pragma: no cover
    sys.exit(pytest.main([__file__, "-q"]))

def test_qc_calendar_quarter_label_for_non_indian():
    # QC: Indian Apr–Mar FY labels were applied to US companies (AAPL Jun-2026 → "Q1 FY2027").
    from backend.results_tracker import service as rs

    assert rs._calendar_quarter_label("2026-06-30") == "Q2 2026"
    assert rs._calendar_quarter_label("2025-12-31") == "Q4 2025"
    assert rs._calendar_quarter_label(None) is None


def test_qc_yfinance_quarterly_uses_market_symbol(monkeypatch):
    # QC: the fallback appended ".NS" to every bare symbol, so AAPL became AAPL.NS (no data).
    import asyncio
    from backend.equity.services import earnings as em
    from backend.shared import market_classifier as mc

    seen = []

    class _Ticker:
        def __init__(self, sym):
            seen.append(sym)
            self.quarterly_income_stmt = None
            self.quarterly_financials = None

    async def fake_symbol(sym):
        return "AAPL" if sym == "AAPL" else f"{sym}.NS"

    monkeypatch.setattr(em.yf, "Ticker", _Ticker)
    monkeypatch.setattr(mc.market_classifier, "yfinance_symbol", fake_symbol)
    asyncio.run(em.earnings_service._quarterly_from_yfinance("AAPL"))
    assert seen == ["AAPL"]
