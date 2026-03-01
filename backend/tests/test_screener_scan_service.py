from __future__ import annotations

import asyncio

import pandas as pd

from backend.services.screener_scan_service import FMPScreenerAdapter, NSEScreenerAdapter, merge_scan_rows, normalize_scan_row


def test_normalize_scan_row_maps_common_aliases() -> None:
    row = normalize_scan_row(
        {
            "ticker": "INFY",
            "pe": 22.5,
            "roe_pct": 17.1,
            "rev_growth_pct": 11.0,
        },
        exchange_hint="NSE",
        country_hint="IN",
    )
    assert row["symbol"] == "INFY"
    assert row["exchange"] == "NSE"
    assert row["country"] == "IN"
    assert row["pe_ratio"] == 22.5
    assert row["roe"] == 17.1
    assert row["revenue_growth_yoy"] == 11.0


def test_merge_scan_rows_deduplicates_symbol_exchange() -> None:
    rows = [
        {"symbol": "AAPL", "exchange": "NASDAQ", "market_cap": 100},
        {"symbol": "AAPL", "exchange": "NASDAQ", "market_cap": 200},
        {"symbol": "AAPL", "exchange": "NYSE", "market_cap": 300},
    ]
    merged = merge_scan_rows(rows)
    assert len(merged) == 2
    assert any(x["market_cap"] == 200 for x in merged)
    assert any(x["market_cap"] == 300 for x in merged)


def test_nse_adapter_normalizes_rows() -> None:
    async def _hydrate_rows(_tickers, _warnings, _refresh_cap):
        return pd.DataFrame([{"ticker": "TCS", "market_cap": 1234, "pe": 26.0}]), 0

    def _load_universe(_universe: str) -> list[str]:
        return ["TCS", "INFY"]

    adapter = NSEScreenerAdapter(hydrate_rows=_hydrate_rows, load_universe=_load_universe, universe_limit=50, refresh_cap=10)
    warnings: list[dict[str, str]] = []
    rows = asyncio.run(adapter.fetch(warnings))
    assert len(rows) == 1
    assert rows[0]["exchange"] == "NSE"
    assert rows[0]["country"] == "IN"
    assert rows[0]["symbol"] == "TCS"


def test_fmp_adapter_filters_requested_markets() -> None:
    async def _snapshot(symbol: str) -> dict[str, object]:
        exchange = "NYSE" if symbol == "IBM" else "NASDAQ"
        return {"ticker": symbol, "exchange": exchange, "market_cap": 1000}

    adapter = FMPScreenerAdapter(snapshot_fetcher=_snapshot, seed_symbols=["AAPL", "IBM"], max_concurrency=4)
    rows = asyncio.run(adapter.fetch(["NASDAQ"]))
    assert len(rows) == 1
    assert rows[0]["symbol"] == "AAPL"
    assert rows[0]["exchange"] == "NASDAQ"
