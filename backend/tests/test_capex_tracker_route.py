from __future__ import annotations

import asyncio

from backend.api.routes import stocks


def test_capex_tracker_prefers_reported_and_marks_estimated(monkeypatch) -> None:
    class _FakeFetcher:
        async def fetch_10yr_financials(self, ticker: str):  # noqa: ARG002
            return {
                "yahoo_fundamentals": {
                    "annualCapitalExpenditure": {
                        "value": [
                            {"asOfDate": "2023-03-31", "reportedValue": {"raw": -1200}},
                            {"asOfDate": "2024-03-31", "reportedValue": {"raw": -1400}},
                        ]
                    }
                },
                "fmp_cashflow": [
                    {"date": "2025-03-31", "operatingCashFlow": 10000},
                ],
            }

    async def _fake_get_unified_fetcher():
        return _FakeFetcher()

    monkeypatch.setattr(stocks, "get_unified_fetcher", _fake_get_unified_fetcher)
    result = asyncio.run(stocks.get_capex_tracker("reliance"))

    assert result.symbol == "RELIANCE"
    assert len(result.points) == 3
    assert result.points[0].source == "reported"
    assert result.points[2].source == "estimated"
    assert result.points[2].capex == 2000.0
