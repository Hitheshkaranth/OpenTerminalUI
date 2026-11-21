"""The legacy portfolio reports each holding's currency and never sums mixed currencies."""
from __future__ import annotations

import asyncio
from backend.api.routes import portfolio
from backend.tests.test_market_classification_integration import (
    _FAKE_USER,
    _FakeDB,
    _FakeHolding,
    _us_classification,
)

PRICES = {"AAPL": 200.0, "MSFT": 400.0, "RELIANCE": 1400.0}


def _patch(monkeypatch) -> None:
    async def _fake_snapshot(symbol: str):
        return {"current_price": PRICES[symbol], "sector": "Tech"}

    async def _fake_classify(symbol: str):
        base = _us_classification(symbol)
        if symbol == "RELIANCE":
            return base.model_copy(update={"exchange": "NSE", "country_code": "IN", "country_name": "India", "flag_emoji": "🇮🇳", "currency": "INR"})
        return base

    monkeypatch.setattr(portfolio, "fetch_stock_snapshot_coalesced", _fake_snapshot)
    monkeypatch.setattr(portfolio.market_classifier, "classify", _fake_classify)


def _run(holdings):
    return asyncio.run(portfolio.get_portfolio(db=_FakeDB(holdings=holdings), current_user=_FAKE_USER))


def test_single_currency_book_reports_its_currency_and_totals(monkeypatch) -> None:
    _patch(monkeypatch)
    out = _run([
        _FakeHolding(id=1, ticker="AAPL", quantity=2, avg_buy_price=150, buy_date="2025-01-01"),
        _FakeHolding(id=2, ticker="MSFT", quantity=1, avg_buy_price=350, buy_date="2025-01-01"),
    ])
    assert [row["currency"] for row in out["items"]] == ["USD", "USD"]
    s = out["summary"]
    assert s["currency"] == "USD" and s["mixed_currency"] is False
    assert s["total_cost"] == 650 and s["total_value"] == 800 and s["overall_pnl"] == 150


def test_inr_book_is_inr(monkeypatch) -> None:
    _patch(monkeypatch)
    out = _run([_FakeHolding(id=1, ticker="RELIANCE", quantity=10, avg_buy_price=1200, buy_date="2025-01-01")])
    assert out["items"][0]["currency"] == "INR"
    assert out["summary"]["currency"] == "INR" and out["summary"]["total_value"] == 14000


def test_mixed_book_is_never_summed_across_currencies(monkeypatch) -> None:
    _patch(monkeypatch)
    out = _run([
        _FakeHolding(id=1, ticker="AAPL", quantity=2, avg_buy_price=150, buy_date="2025-01-01"),
        _FakeHolding(id=2, ticker="RELIANCE", quantity=10, avg_buy_price=1200, buy_date="2025-01-01"),
    ])
    s = out["summary"]
    assert s["mixed_currency"] is True and s["currency"] is None
    # No fake cross-currency total: the single totals are withheld...
    assert s["total_cost"] is None and s["total_value"] is None and s["overall_pnl"] is None
    # ...and each currency is reported on its own.
    assert s["totals_by_currency"]["USD"] == {"total_cost": 300, "total_value": 400, "overall_pnl": 100}
    assert s["totals_by_currency"]["INR"] == {"total_cost": 12000, "total_value": 14000, "overall_pnl": 2000}
