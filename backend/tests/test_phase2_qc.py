from __future__ import annotations

import unittest

import pandas as pd
from fastapi.testclient import TestClient

from backend.api.routes import peers, screener
from backend.main import app


class _FakeFetcher:
    def fetch_fundamental_snapshot(self, ticker: str, include_history: bool = False, include_full_info: bool = False) -> dict:
        symbol = ticker.upper()
        base_price = {"AAA": 120.0, "BBB": 90.0, "CCC": 60.0}.get(symbol, 100.0)
        info = {
            "shortName": f"{symbol} Corp",
            "currentPrice": base_price,
            "marketCap": base_price * 1_000_000,
            "trailingEps": max(1.0, base_price / 20.0),
            "bookValue": max(1.0, base_price / 8.0),
            "priceToBook": 2.2,
            "enterpriseValue": base_price * 1_100_000,
            "ebitda": base_price * 50_000,
            "returnOnEquity": 0.12 if symbol != "CCC" else 0.08,
            "returnOnAssets": 0.05 if symbol != "CCC" else 0.03,
            "operatingMargins": 0.18 if symbol == "AAA" else 0.12,
            "profitMargins": 0.1 if symbol == "AAA" else 0.07,
            "revenueGrowth": 0.15 if symbol != "CCC" else 0.04,
            "earningsGrowth": 0.2 if symbol == "AAA" else 0.06,
            "beta": 1.05,
            "sector": "IT",
            "industry": "Software",
        }
        return {
            "ticker": symbol,
            "symbol": f"{symbol}.NS",
            "info": info,
            "income_stmt": pd.DataFrame(),
            "quarterly_income_stmt": pd.DataFrame(),
            "balance_sheet": pd.DataFrame(),
            "quarterly_balance_sheet": pd.DataFrame(),
            "cashflow": pd.DataFrame(),
            "quarterly_cashflow": pd.DataFrame(),
            "history_1y": pd.DataFrame(),
        }


class Phase2QCTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self._orig_peers_fetcher = peers.fetcher
        self._orig_screener_fetcher = screener.fetcher
        self._orig_default_universe = peers._default_universe
        peers.fetcher = _FakeFetcher()
        screener.fetcher = _FakeFetcher()
        peers._default_universe = lambda: ["AAA", "BBB", "CCC"]

    def tearDown(self) -> None:
        peers.fetcher = self._orig_peers_fetcher
        screener.fetcher = self._orig_screener_fetcher
        peers._default_universe = self._orig_default_universe

    def test_peers_compare_static_route_not_shadowed(self) -> None:
        response = self.client.get("/api/peers/compare", params={"tickers": "aaa,bbb"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"tickers": ["AAA", "BBB"]})

    def test_peers_metrics_query_is_applied(self) -> None:
        response = self.client.get("/api/peers/AAA", params={"metrics": "growth"})
        self.assertEqual(response.status_code, 200)
        metrics = [row["metric"] for row in response.json()["metrics"]]
        self.assertTrue(metrics)
        self.assertTrue(set(metrics).issubset({"rev_growth_pct", "eps_growth_pct"}))

    def test_screener_type_mismatch_rule_does_not_500(self) -> None:
        payload = {
            "rules": [{"field": "company_name", "op": ">", "value": 1}],
            "sort_by": "roe_pct",
            "sort_order": "desc",
            "limit": 5,
            "universe": "nse_eq",
        }
        response = self.client.post("/api/screener/run", json=payload)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("rows", body)
        self.assertIsInstance(body["rows"], list)


if __name__ == "__main__":
    unittest.main()
