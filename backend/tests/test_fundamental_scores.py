from __future__ import annotations

import unittest

from backend.core.fundamental_scores import (
    altman_z_score,
    cagr,
    cash_conversion_cycle,
    dvm_score,
    dupont_analysis,
    fcf_yield,
    graham_number,
    magic_formula_rank,
    peg_ratio,
    piotroski_f_score,
)


class FundamentalScoresTests(unittest.TestCase):
    def test_piotroski_full_score(self) -> None:
        financials = {
            "roa": 0.12,
            "roa_prev": 0.1,
            "cfo": 120,
            "net_income": 100,
            "long_term_debt": 80,
            "long_term_debt_prev": 100,
            "total_assets": 500,
            "total_assets_prev": 500,
            "current_ratio": 1.8,
            "current_ratio_prev": 1.5,
            "shares_outstanding": 100,
            "shares_outstanding_prev": 100,
            "gross_margin": 0.45,
            "gross_margin_prev": 0.4,
            "asset_turnover": 1.2,
            "asset_turnover_prev": 1.0,
        }
        self.assertEqual(piotroski_f_score(financials), 9)

    def test_altman(self) -> None:
        score = altman_z_score(
            {
                "working_capital": 100,
                "retained_earnings": 250,
                "ebit": 80,
                "market_value_equity": 600,
                "total_liabilities": 300,
                "sales": 700,
                "total_assets": 900,
            }
        )
        self.assertGreater(score, 2.0)

    def test_simple_metrics(self) -> None:
        self.assertGreater(graham_number(20, 100), 0)
        self.assertAlmostEqual(peg_ratio(24, 12), 2.0, places=6)
        self.assertAlmostEqual(magic_formula_rank(0.06, 0.22), 0.28, places=6)
        self.assertAlmostEqual(cash_conversion_cycle(50, 40, 30), 60.0, places=6)
        self.assertAlmostEqual(fcf_yield(100, 1000), 10.0, places=6)
        self.assertAlmostEqual(cagr(100, 200, 5), 14.8698, places=3)

    def test_dupont(self) -> None:
        out = dupont_analysis(100, 1000, 500, 250)
        self.assertAlmostEqual(out["profit_margin"], 0.1, places=6)
        self.assertAlmostEqual(out["asset_turnover"], 2.0, places=6)
        self.assertAlmostEqual(out["equity_multiplier"], 2.0, places=6)
        self.assertAlmostEqual(out["roe"], 0.4, places=6)

    def test_dvm_score(self) -> None:
        out = dvm_score(90, 70, 80)
        self.assertIn("overall", out)
        self.assertEqual(out["band"], "strong")


if __name__ == "__main__":
    unittest.main()
