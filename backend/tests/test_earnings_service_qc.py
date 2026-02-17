from __future__ import annotations

import asyncio
from datetime import date, timedelta

from backend.equity.services.earnings import EarningsDate, EarningsService


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


def test_get_portfolio_earnings_parallel_filters_and_sorts(monkeypatch) -> None:
    service = EarningsService()
    today = date.today()

    async def _fake_next(symbol: str):
        mapping = {
            "B": _earning("B", today + timedelta(days=2)),
            "A": _earning("A", today + timedelta(days=5)),
            "C": _earning("C", today + timedelta(days=45)),
        }
        return mapping[symbol]

    monkeypatch.setattr(service, "get_next_earnings", _fake_next)
    out = asyncio.run(service.get_portfolio_earnings(["A", "B", "C"], days_ahead=30))
    assert [x.symbol for x in out] == ["B", "A"]
