from __future__ import annotations

import asyncio
from datetime import date

from backend.equity.routes import earnings
from backend.equity.services.earnings import EarningsDate


def _earning(symbol: str, day: date) -> EarningsDate:
    return EarningsDate(
        symbol=symbol,
        company_name=symbol,
        earnings_date=day,
        fiscal_quarter="Q4 FY2025",
        fiscal_year=2025,
        quarter=4,
        source="test",
        time="bmo",
    )


def test_calendar_endpoint(monkeypatch) -> None:
    async def _fake_calendar(from_date=None, to_date=None, symbols=None):  # noqa: ANN001
        return [_earning("RELIANCE", date(2025, 2, 20))]

    monkeypatch.setattr(earnings.earnings_service, "get_earnings_calendar", _fake_calendar)
    out = asyncio.run(earnings.get_earnings_calendar("2025-02-01", "2025-03-01", "RELIANCE"))
    assert out["count"] == 1
    assert out["items"][0]["symbol"] == "RELIANCE"


def test_next_endpoint(monkeypatch) -> None:
    async def _fake_next(symbol: str):
        return _earning(symbol, date(2025, 2, 20))

    monkeypatch.setattr(earnings.earnings_service, "get_next_earnings", _fake_next)
    out = asyncio.run(earnings.get_next_earnings("INFY"))
    assert out["item"]["symbol"] == "INFY"


def test_portfolio_endpoint(monkeypatch) -> None:
    async def _fake_portfolio(symbols: list[str], days_ahead: int = 30):
        assert symbols == ["RELIANCE", "INFY"]
        assert days_ahead == 60
        return [_earning("INFY", date(2025, 2, 11)), _earning("RELIANCE", date(2025, 2, 25))]

    monkeypatch.setattr(earnings.earnings_service, "get_portfolio_earnings", _fake_portfolio)
    out = asyncio.run(earnings.get_portfolio_earnings("RELIANCE,INFY", days=60))
    assert out["count"] == 2
    assert out["items"][0]["symbol"] == "INFY"
